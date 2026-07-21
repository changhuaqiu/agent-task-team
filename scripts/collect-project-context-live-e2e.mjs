import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import Database from 'better-sqlite3';

const evaluatorRevision = 'project-context-live-e2e-v1';

function usage() {
  return [
    'Usage:',
    '  node scripts/collect-project-context-live-e2e.mjs \\',
    '    --db <candidate data.db> \\',
    '    --blank-conversation <id> --blank-project <path> \\',
    '    --existing-conversation <id> --existing-project <path> \\',
    '    [--baseline-db <data.db> --baseline-conversation <id>] \\',
    '    [--out <artifact.json>]',
  ].join('\n');
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    result[key.slice(2)] = value;
    index += 1;
  }
  return result;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pathIdentity(value) {
  const resolved = path.resolve(value);
  let canonical = resolved;
  try {
    canonical = fs.realpathSync.native(resolved);
  } catch {
    // Missing/tampered evidence must still produce a stable mismatch instead
    // of making the collector fall back to an unrelated current directory.
  }
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical;
}

function isWithin(root, target) {
  const relative = path.relative(pathIdentity(root), pathIdentity(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isNonNegativeInteger(value) {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function parseProbeResponse(content) {
  const fields = {};
  for (const item of content.split(/[;\r\n]+/)) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (key) fields[key] = value;
  }
  return fields;
}

function countPromptTopologyItems(prompt) {
  const startMarker = '## 任务相关 Code Topology';
  const endMarker = '## 可信开发命令';
  const start = prompt.indexOf(startMarker);
  if (start < 0) return null;
  const end = prompt.indexOf(endMarker, start + startMarker.length);
  const section = prompt.slice(start, end < 0 ? undefined : end);
  return section.split(/\r?\n/).filter(line => /^- `[^`]+` \[/.test(line)).length;
}

function loadInvocationEvidence(db, conversationId) {
  const conversation = db.prepare(`
    SELECT id, project_path
      FROM conversation
     WHERE id = ?
     LIMIT 1
  `).get(conversationId);
  if (!conversation) throw new Error(`No conversation found for ${conversationId}`);

  const invocation = db.prepare(`
    SELECT id, status, engine, account_id, prompt, token_usage,
           error_message, created_at, updated_at
      FROM invocation
     WHERE conversation_id = ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(conversationId);
  if (!invocation) throw new Error(`No invocation found for ${conversationId}`);

  const span = db.prepare(`
    SELECT span_id, kind, status, attributes, started_at, ended_at
      FROM observation_span
     WHERE invocation_id = ? AND name = 'context.assemble'
     ORDER BY started_at DESC
     LIMIT 1
  `).get(invocation.id);
  if (!span) throw new Error(`No context.assemble span found for invocation ${invocation.id}`);

  const response = db.prepare(`
    SELECT content, created_at
      FROM chat_message
     WHERE conversation_id = ?
       AND sender_type = 'agent'
       AND invocation_id = ?
     ORDER BY created_at DESC
     LIMIT 1
  `).get(conversationId, invocation.id);
  if (!response) throw new Error(`No Agent response found for invocation ${invocation.id}`);

  const invocationSpans = db.prepare(`
    SELECT name, kind, status
      FROM observation_span
     WHERE invocation_id = ?
     ORDER BY started_at
  `).all(invocation.id);
  const observedToolSpans = invocationSpans.filter(item => (
    item.kind === 'tool' || /(?:^|\.)tool(?:\.|$)/i.test(item.name)
  ));
  const durableToolUseMessages = db.prepare(`
    SELECT id, sender_type, sender_id, created_at
      FROM chat_message
     WHERE invocation_id = ? AND content_type = 'tool_use'
     ORDER BY created_at
  `).all(invocation.id);

  const attributes = parseJson(span.attributes, {});
  const layers = attributes?.report?.layers ?? [];
  const projectContextLayers = layers.filter(layer => (
    String(layer.layer).includes('project-context')
  ));

  return {
    conversation,
    invocation,
    span,
    response,
    attributes,
    projectContextLayers,
    invocationSpans,
    observedToolSpans,
    durableToolUseMessages,
  };
}

function collectCandidateCase(db, label, conversationId, projectRoot) {
  const manifestPath = path.join(projectRoot, '.ath', 'context', 'manifest.json');
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestText);
  const fixtureName = path.basename(projectRoot);
  const evidence = loadInvocationEvidence(db, conversationId);
  const {
    conversation,
    invocation,
    span,
    response,
    attributes,
    projectContextLayers,
    invocationSpans,
    observedToolSpans,
    durableToolUseMessages,
  } = evidence;
  const fields = parseProbeResponse(response.content);
  const promptTopologyItems = countPromptTopologyItems(invocation.prompt);
  const expectedProbe = label === 'blank' ? 'BLANK' : 'EXISTING';
  const buildCommand = manifest.commands.find(command => command.name === 'build')?.command;
  const resolvedProjectRoot = path.resolve(projectRoot);
  const expectedManifestPath = path.join(resolvedProjectRoot, '.ath', 'context', 'manifest.json');
  const expectedTopologyPath = path.join(resolvedProjectRoot, '.ath', 'context', 'topology.json');
  const expectedLayer = `fragment:project-context:project-context:${conversationId}`;
  const projectContextFragmentRefs = (attributes?.snapshot?.fragmentRefs ?? []).filter(ref => (
    ref.producer === 'project-context'
  ));
  const projectContextFragmentRef = projectContextFragmentRefs[0];
  const fragmentEvidenceRefs = projectContextFragmentRef?.evidenceRefs ?? [];
  const expectedFragmentVersionPrefix = `r${manifest.revision}:${manifest.sourceFingerprint.slice(0, 12)}:`;
  const promptAnchors = [
    '## 项目上下文入口',
    `代码库：${manifest.project.name}`,
    `共享 revision：${manifest.revision}`,
    `类型：${manifest.project.kind}`,
    '## 任务相关 Code Topology',
  ];

  const checks = {
    invocationSucceeded: invocation.status === 'succeeded' && !invocation.error_message,
    realRuntimeSelected: ['claude', 'codex', 'opencode'].includes(invocation.engine)
      && Boolean(invocation.account_id),
    noObservedToolSpans: observedToolSpans.length === 0,
    noDurableToolUseMessages: durableToolUseMessages.length === 0,
    contextSpanComplete: span.kind === 'context'
      && span.status === 'ok'
      && Boolean(span.ended_at),
    conversationProjectPathMatches: Boolean(conversation.project_path)
      && pathIdentity(conversation.project_path) === pathIdentity(resolvedProjectRoot),
    manifestRootMatches: Boolean(manifest.project.root)
      && pathIdentity(manifest.project.root) === pathIdentity(resolvedProjectRoot),
    projectContextLayerPresent: projectContextLayers.length === 1
      && projectContextLayers[0].layer === expectedLayer,
    projectContextLayerUntrimmed: projectContextLayers.length === 1
      && projectContextLayers[0].trimmed === false,
    snapshotConversationMatches: attributes?.snapshot?.query?.conversationId === conversationId,
    projectContextFragmentRefMatches: projectContextFragmentRefs.length === 1
      && projectContextFragmentRef?.id === `project-context:${conversationId}`
      && projectContextFragmentRef?.kind === 'project.context.capsule'
      && projectContextFragmentRef?.producer === 'project-context'
      && projectContextFragmentRef?.scope?.kind === 'project'
      && projectContextFragmentRef?.scope?.projectId === conversationId
      && projectContextFragmentRef?.subject?.kind === 'project'
      && projectContextFragmentRef?.subject?.id === conversationId
      && projectContextFragmentRef?.version?.startsWith(expectedFragmentVersionPrefix),
    projectContextEvidenceMatches: fragmentEvidenceRefs.some(ref => (
      pathIdentity(ref) === pathIdentity(expectedManifestPath)
    )) && fragmentEvidenceRefs.some(ref => (
      pathIdentity(ref) === pathIdentity(expectedTopologyPath)
    )) && fragmentEvidenceRefs.every(ref => isWithin(resolvedProjectRoot, path.resolve(ref))),
    promptContainsGeneratedCapsule: promptAnchors.every(anchor => invocation.prompt.includes(anchor)),
    manifestCaseMatches: label === 'blank'
      ? manifest.project.kind === 'empty'
        && manifest.topology.moduleCount === 0
        && manifest.commands.length === 0
      : manifest.project.kind === 'codebase'
        && manifest.topology.moduleCount > 0
        && Boolean(buildCommand),
    responseProbeMatches: fields.PROBE === expectedProbe,
    responseProjectMatches: fields.PROJECT_NAME === manifest.project.name,
    responseKindMatches: fields.KIND === manifest.project.kind,
    responseRevisionMatches: isNonNegativeInteger(fields.REVISION)
      && Number(fields.REVISION) === manifest.revision,
    responseTopologyMatches: isNonNegativeInteger(fields.TOPOLOGY_ITEMS)
      && promptTopologyItems !== null
      && Number(fields.TOPOLOGY_ITEMS) === promptTopologyItems,
    responseCaseContractMatches: label === 'blank'
      ? fields.TRUSTED_COMMANDS === 'NONE' && fields.PARENT_SCAN_ALLOWED === 'NO'
      : fields.BUILD_COMMAND === buildCommand,
  };

  return {
    label,
    conversationId,
    fixtureName,
    binding: {
      conversationProjectPathHash: sha256(pathIdentity(conversation.project_path ?? '')),
      suppliedProjectPathHash: sha256(pathIdentity(resolvedProjectRoot)),
      manifestRootHash: sha256(pathIdentity(manifest.project.root ?? '')),
    },
    manifest: {
      sha256: sha256(manifestText),
      project: {
        ...manifest.project,
        root: `<fixture>/${fixtureName}`,
      },
      revision: manifest.revision,
      moduleCount: manifest.topology.moduleCount,
      edgeCount: manifest.topology.edgeCount,
      commandCount: manifest.commands.length,
      buildCommand: buildCommand ?? null,
      testCommand: manifest.commands.find(command => command.name === 'test')?.command ?? null,
      knowledgePaths: manifest.knowledge.map(entry => entry.path),
      diagnostics: manifest.diagnostics,
    },
    execution: {
      invocationId: invocation.id,
      status: invocation.status,
      engine: invocation.engine,
      accountRefHash: sha256(invocation.account_id ?? '').slice(0, 12),
      createdAt: invocation.created_at,
      updatedAt: invocation.updated_at,
      durationMs: Date.parse(invocation.updated_at) - Date.parse(invocation.created_at),
      tokenUsage: parseJson(invocation.token_usage, null),
      promptChars: invocation.prompt.length,
      promptSha256: sha256(invocation.prompt),
      promptTopologyItems,
      response: response.content,
      responseSha256: sha256(response.content),
      observationSpans: invocationSpans,
      observedToolSpans,
      durableToolUseMessages,
    },
    contextAssembly: {
      spanId: span.span_id,
      startedAt: span.started_at,
      endedAt: span.ended_at,
      tokensUsed: attributes?.report?.tokensUsed ?? null,
      tokenBudget: attributes?.report?.tokensBudget ?? null,
      projectContextLayers,
      projectContextFragmentRefs: projectContextFragmentRefs.map(ref => ({
        ...ref,
        evidenceRefs: (ref.evidenceRefs ?? []).map(evidenceRef => (
          isWithin(resolvedProjectRoot, path.resolve(evidenceRef))
            ? `<fixture>/${path.relative(resolvedProjectRoot, evidenceRef).replaceAll('\\', '/')}`
            : '<outside-fixture>'
        )),
      })),
    },
    checks,
    passed: Object.values(checks).every(Boolean),
  };
}

function collectBaseline(dbPath, conversationId) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const evidence = loadInvocationEvidence(db, conversationId);
    const { invocation, response, attributes, projectContextLayers } = evidence;
    const systemFailure = db.prepare(`
      SELECT id, content, created_at
        FROM chat_message
       WHERE conversation_id = ?
         AND sender_type = 'agent'
         AND sender_id = 'system'
         AND content LIKE '%未启动%'
       ORDER BY created_at
       LIMIT 1
    `).get(conversationId);
    const humanMessages = db.prepare(`
      SELECT id, content, created_at
        FROM chat_message
       WHERE conversation_id = ? AND sender_type = 'human'
       ORDER BY created_at
    `).all(conversationId);
    const nearestHuman = systemFailure
      ? humanMessages
        .map(message => ({
          ...message,
          distanceMs: Math.abs(Date.parse(message.created_at) - Date.parse(systemFailure.created_at)),
        }))
        .sort((left, right) => left.distanceMs - right.distanceMs)[0]
      : null;
    const nextHuman = nearestHuman
      ? humanMessages.find(message => message.created_at > nearestHuman.created_at)
      : null;
    const invocationsBeforeNextHuman = nearestHuman && nextHuman
      ? db.prepare(`
          SELECT COUNT(*) AS count
            FROM invocation
           WHERE conversation_id = ?
             AND created_at >= ?
             AND created_at < ?
        `).get(conversationId, nearestHuman.created_at, nextHuman.created_at).count
      : null;
    const preflightFailure = systemFailure && nearestHuman
      ? {
        systemMessage: systemFailure.content,
        systemMessageAt: systemFailure.created_at,
        humanPromptSha256: sha256(nearestHuman.content),
        humanPromptAt: nearestHuman.created_at,
        nextHumanPromptAt: nextHuman?.created_at ?? null,
        invocationsBeforeNextHuman,
        observedFailure: nearestHuman.distanceMs <= 1_000
          && invocationsBeforeNextHuman === 0,
      }
      : null;
    return {
      conversationId,
      invocationId: invocation.id,
      status: invocation.status,
      engine: invocation.engine,
      promptChars: invocation.prompt.length,
      promptSha256: sha256(invocation.prompt),
      generatedCapsuleHeadingPresent: invocation.prompt.includes('## 项目上下文入口'),
      projectContextLayers,
      contextTokensUsed: attributes?.report?.tokensUsed ?? null,
      response: response.content,
      responseSha256: sha256(response.content),
      preflightFailure,
      observedFailure: projectContextLayers.length === 0
        && !invocation.prompt.includes('## 项目上下文入口'),
    };
  } finally {
    db.close();
  }
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
  for (const key of [
    'db',
    'blank-conversation',
    'blank-project',
    'existing-conversation',
    'existing-project',
  ]) {
    if (!args[key]) throw new Error(`Missing --${key}`);
  }
  if (Boolean(args['baseline-db']) !== Boolean(args['baseline-conversation'])) {
    throw new Error('--baseline-db and --baseline-conversation must be provided together');
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(usage());
  process.exit(2);
}

const candidateDb = new Database(path.resolve(args.db), { readonly: true });
let candidateCases;
try {
  candidateCases = [
    collectCandidateCase(
      candidateDb,
      'blank',
      args['blank-conversation'],
      path.resolve(args['blank-project']),
    ),
    collectCandidateCase(
      candidateDb,
      'existing',
      args['existing-conversation'],
      path.resolve(args['existing-project']),
    ),
  ];
} finally {
  candidateDb.close();
}

const baseline = args['baseline-db']
  ? collectBaseline(path.resolve(args['baseline-db']), args['baseline-conversation'])
  : null;
const evidenceObservedThrough = candidateCases
  .map(item => item.execution.updatedAt)
  .sort()
  .at(-1);
const payload = {
  schemaVersion: 1,
  evaluatorRevision,
  // Derive the artifact timestamp from immutable source evidence so rerunning
  // the collector over the same invocations produces the same digest.
  generatedAt: evidenceObservedThrough,
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  method: {
    cases: ['blank', 'existing'],
    dispatch: 'browser UI to real configured Agent account',
    probeConstraint: 'no tools, no directory reads, no file modifications',
    oracle: 'manifest + invocation prompt + context.assemble span + Agent response',
  },
  baseline,
  candidateCases,
  summary: {
    passedCases: candidateCases.filter(item => item.passed).length,
    totalCases: candidateCases.length,
    passedChecks: candidateCases.reduce((total, item) => (
      total + Object.values(item.checks).filter(Boolean).length
    ), 0),
    totalChecks: candidateCases.reduce((total, item) => (
      total + Object.keys(item.checks).length
    ), 0),
    allPassed: candidateCases.every(item => item.passed),
    baselineFailureObserved: baseline?.observedFailure ?? null,
    preflightFailureObserved: baseline?.preflightFailure?.observedFailure ?? null,
  },
};
const artifact = {
  ...payload,
  payloadSha256: sha256(JSON.stringify(payload)),
};
const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

if (args.out) {
  const outputPath = path.resolve(args.out);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, serialized, 'utf8');
}

process.stdout.write(serialized);
process.exit(artifact.summary.allPassed ? 0 : 1);
