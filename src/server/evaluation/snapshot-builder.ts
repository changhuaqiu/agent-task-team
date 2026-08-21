import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getDb } from '../db';
import { listAccounts } from '../accounts-file';
import { redactObservationPreview } from '../observability/redaction';
import { DEFAULT_RUBRIC_REVISION_ID, EVALUATOR_BUNDLE_REVISION, digest } from './defaults';
import type { ApplicationManifest } from './application-snapshot';
import type { EvaluationRequest, EvidenceRef, SubjectSnapshot } from './types';
import { collectEvaluationExecutionEvidence } from './execution-evidence';

type Row = Record<string, unknown>;

function rows(sql: string, ...params: unknown[]): Row[] {
  return getDb().prepare(sql).all(...params) as Row[];
}

function parse(value: unknown, fallback: unknown = null): unknown {
  if (typeof value !== 'string') return value ?? fallback;
  try { return JSON.parse(value); } catch { return value; }
}

function sanitizeStructured(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return redactObservationPreview(value, 4_000);
  if (Array.isArray(value)) return value.slice(0, 2_000).map((item) => sanitizeStructured(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .slice(0, 2_000).map(([key, item]) => [key, sanitizeStructured(item, depth + 1)]));
  }
  return value;
}

function cleanRow(row: Row): Row {
  const result: Row = {};
  for (const [key, value] of Object.entries(row)) {
    if (['prompt', 'input_preview', 'output_preview', 'content', 'error_message'].includes(key)) {
      result[key] = redactObservationPreview(value, 4_000);
    } else if (['metadata', 'payload', 'attributes', 'task_ids', 'artifacts', 'dependencies', 'usage',
      'input_payload', 'expected_labels'].includes(key)) {
      result[key] = sanitizeStructured(parse(value, {}));
    } else if (typeof value === 'string') {
      result[key] = redactObservationPreview(value, 4_000);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function collaborationEventEvidenceRef(event: Row): EvidenceRef {
  const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
    ? event.payload as Record<string, unknown>
    : {};
  const chainId = payload.chainId ?? payload.chain_id;
  const passId = payload.passId ?? payload.pass_id;
  return {
    kind: 'event',
    id: String(event.id),
    chainId: chainId ? String(chainId) : undefined,
    passId: passId ? String(passId) : undefined,
  };
}

function collectTaskIds(tasks: Row[], edges: Row[], rootTaskId?: string): Set<string> {
  if (!rootTaskId) return new Set(tasks.map((task) => String(task.id)));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.type !== 'subtask_of') continue;
    const parent = String(edge.to_task_id);
    children.set(parent, [...(children.get(parent) ?? []), String(edge.from_task_id)]);
  }
  const selected = new Set([rootTaskId]);
  const stack = [rootTaskId];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const child of children.get(parent) ?? []) {
      if (!selected.has(child)) { selected.add(child); stack.push(child); }
    }
  }
  return selected;
}

function gitRevision(projectPath: unknown): string | undefined {
  if (typeof projectPath !== 'string' || !projectPath) return undefined;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectPath, encoding: 'utf8', timeout: 1_500, windowsHide: true,
    }).trim();
  } catch { return undefined; }
}

function frozenApplicationManifest(value: unknown): ApplicationManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = value as Partial<ApplicationManifest>;
  if (
    candidate.schemaVersion !== 1
    || typeof candidate.projectPath !== 'string'
    || !candidate.projectPath.trim()
    || typeof candidate.codeRevision !== 'string'
    || !candidate.codeRevision.trim()
    || !candidate.team
    || !Array.isArray(candidate.team.roles)
    || !Array.isArray(candidate.agents)
    || candidate.agents.length === 0
    || candidate.agents.some((agent) => !agent
      || typeof agent.agentId !== 'string'
      || !agent.agentId.trim()
      || typeof agent.engine !== 'string'
      || !Array.isArray(agent.skillRevisions)
      || agent.skillRevisions.some((skill) => !skill
        || typeof skill.skillId !== 'string'
        || typeof skill.revisionId !== 'string'
        || typeof skill.contentHash !== 'string'))
  ) return undefined;
  return candidate as ApplicationManifest;
}

interface OfflineExecutionProvenance extends Row {
  application_snapshot_id: string;
  target_manifest_digest: string;
  observed_manifest_digest: string;
  snapshot_manifest_digest: string;
}

export function assertOfflineEvaluationProvenance(request: EvaluationRequest): {
  manifest: ApplicationManifest;
  execution: OfflineExecutionProvenance;
} | undefined {
  if (request.mode !== 'offline') return undefined;
  const manifest = frozenApplicationManifest(request.applicationManifest);
  if (!manifest) {
    throw new Error('Offline evaluation requires a valid frozen application manifest');
  }
  if (!request.triggerId?.trim()) {
    throw new Error('Offline evaluation requires a bound case execution');
  }
  if (!request.caseId?.trim() || !request.rootTaskId?.trim()) {
    throw new Error('Offline evaluation requires a bound case and root task');
  }
  const execution = getDb().prepare(`SELECT
      x.application_snapshot_id,x.case_id,x.task_id,x.harness_trigger_id,x.invocation_id,x.trace_id,
      x.target_manifest_digest,x.observed_manifest_digest,x.status,
      s.manifest_digest AS snapshot_manifest_digest,s.project_path,s.code_revision,s.team_manifest,s.agent_manifest
    FROM eval_case_execution x
    JOIN eval_application_snapshot s ON s.id=x.application_snapshot_id AND s.conversation_id=x.conversation_id
    WHERE x.id=? AND x.conversation_id=?`)
    .get(request.triggerId, request.conversationId) as OfflineExecutionProvenance | undefined;
  if (!execution) {
    throw new Error('Offline evaluation requires valid case execution provenance');
  }
  if (String(execution.case_id) !== request.caseId) {
    throw new Error('Offline evaluation case does not match the bound execution');
  }
  if (String(execution.task_id ?? '') !== request.rootTaskId) {
    throw new Error('Offline evaluation root task does not match the bound execution');
  }
  if (String(execution.harness_trigger_id ?? '') !== request.triggerId) {
    throw new Error('Offline evaluation Harness trigger does not match the bound execution');
  }
  if (!['running', 'evaluating'].includes(String(execution.status))) {
    throw new Error('Offline evaluation requires a running or evaluating case execution');
  }
  if (!execution.invocation_id || !execution.trace_id) {
    throw new Error('Offline evaluation requires a bound invocation and trace');
  }
  const storedManifest = frozenApplicationManifest({
    schemaVersion: 1,
    projectPath: execution.project_path,
    codeRevision: execution.code_revision,
    team: parse(execution.team_manifest, null),
    agents: parse(execution.agent_manifest, null),
  });
  if (!storedManifest || digest(storedManifest) !== String(execution.snapshot_manifest_digest)) {
    throw new Error('Offline evaluation application snapshot is invalid');
  }
  const frozenManifestDigest = digest(manifest);
  const targetDigest = String(execution.target_manifest_digest ?? '');
  const observedDigest = String(execution.observed_manifest_digest ?? '');
  if (!observedDigest) {
    throw new Error('Offline evaluation requires an observed application manifest digest');
  }
  if (
    frozenManifestDigest !== String(execution.snapshot_manifest_digest)
    || targetDigest !== frozenManifestDigest
    || observedDigest !== frozenManifestDigest
  ) {
    throw new Error('Evaluation execution provenance does not match the frozen application manifest');
  }
  return { manifest, execution };
}

function collectTruncatedPaths(value: unknown, path = '$', result: string[] = []): string[] {
  if (result.length >= 200) return result;
  if (typeof value === 'string' && (value.length >= 4_000 || value === '[TRUNCATED_DEPTH]')) result.push(path);
  else if (Array.isArray(value)) value.forEach((item, index) => collectTruncatedPaths(item, `${path}[${index}]`, result));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      collectTruncatedPaths(item, `${path}.${key}`, result);
    }
  }
  return result;
}

export function buildSubjectSnapshot(request: EvaluationRequest): SubjectSnapshot {
  const db = getDb();
  const cutoff = request.evidenceCutoffAt ?? new Date().toISOString();
  if ((request.mode ?? 'online') === 'online' && !request.rootTaskId?.trim()) {
    throw new Error('evaluation_root_task_required');
  }
  const offlineProvenance = assertOfflineEvaluationProvenance(request);
  const frozenApplication = offlineProvenance?.manifest;
  const conversation = db.prepare('SELECT * FROM conversation WHERE id = ?').get(request.conversationId) as Row | undefined;
  if (!conversation) throw new Error('Conversation not found');
  const allTasks = rows('SELECT * FROM task WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at,id',
    request.conversationId, cutoff);
  const allEdges = rows('SELECT * FROM task_edge WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at,id',
    request.conversationId, cutoff);
  if (request.rootTaskId && !allTasks.some((task) => task.id === request.rootTaskId)) {
    throw new Error('Root task does not belong to conversation');
  }
  const taskIds = collectTaskIds(allTasks, allEdges, request.rootTaskId);
  const tasks = allTasks.filter((task) => taskIds.has(String(task.id))).map(cleanRow);
  const edges = allEdges.filter((edge) =>
    taskIds.has(String(edge.from_task_id)) && taskIds.has(String(edge.to_task_id))).map(cleanRow);
  const execution = collectEvaluationExecutionEvidence(db, {
    conversationId: request.conversationId,
    taskIds,
    cutoffAt: cutoff,
    chainId: request.chainId,
  });
  const taskActions = rows('SELECT * FROM task_action WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at,id',
    request.conversationId, cutoff).filter((action) => {
      const ids = parse(action.task_ids, []) as unknown[];
      return ids.some((id) => taskIds.has(String(id)));
    }).map(cleanRow);
  const artifacts = rows('SELECT * FROM task_artifact_ref WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at,id',
    request.conversationId, cutoff).filter((item) => taskIds.has(String(item.task_id))).map(cleanRow);
  const spans = execution.spans.map(cleanRow);
  const spanIds = new Set(spans.map((span) => String(span.span_id)));
  const payloads: Row[] = spanIds.size === 0 ? [] : rows(`SELECT p.* FROM observation_span_payload p
    JOIN observation_span s ON s.span_id=p.span_id
    WHERE s.conversation_id=? AND p.created_at<=? AND p.role<>'thinking'
    ORDER BY p.created_at,p.span_id,p.seq`, request.conversationId, cutoff)
    .filter((payload) => spanIds.has(String(payload.span_id)))
    .map((payload) => ({ ...cleanRow(payload), content: redactObservationPreview(payload.content, 4_000) }));
  const proofs = rows(`SELECT * FROM control_proof_event
    WHERE conversation_id = ? AND created_at <= ? ORDER BY created_at,id`,
    request.conversationId, cutoff).filter((proof) =>
      !String(proof.event_type).startsWith('eval.') && (
        (proof.task_id && taskIds.has(String(proof.task_id))) ||
        (proof.chain_id && execution.chainIds.has(String(proof.chain_id))) ||
        (proof.pass_id && execution.passIds.has(String(proof.pass_id))))).map(cleanRow);
  const messages = rows(`SELECT id,task_id,sender_type,sender_id,content,content_type,invocation_id,created_at
    FROM chat_message WHERE conversation_id=? AND created_at<=? AND visibility='public' ORDER BY created_at,id`,
    request.conversationId, cutoff).filter((message) =>
      (message.task_id && taskIds.has(String(message.task_id))) ||
      (message.invocation_id && execution.invocationIds.has(String(message.invocation_id)))).map(cleanRow);
  const invocations = execution.invocations.map(cleanRow);
  const contracts = execution.contracts.map(cleanRow);
  const chains = execution.chains.map(cleanRow);
  const passGroups = execution.passGroups.map(cleanRow);
  const passes = execution.passes.map(cleanRow);
  const collaborationEvents = execution.collaborationEvents.map(cleanRow);
  const lateFacts = execution.lateFacts;
  const evaluationCase = request.caseId
    ? db.prepare(`SELECT c.id,c.case_key,c.split,c.expected_labels,c.metadata
        FROM eval_case c JOIN eval_dataset d ON d.id=c.dataset_id
        WHERE c.id=? AND (d.conversation_id=? OR d.conversation_id IS NULL)`)
      .get(request.caseId, request.conversationId) as Row | undefined
    : undefined;

  const roleRows = !frozenApplication && conversation.team_pack_id
    ? rows('SELECT role_id,role_card_id,role_card_snapshot,account_ids,skill_ids FROM team_pack_role WHERE pack_id=? ORDER BY role_id',
        conversation.team_pack_id)
    : [];
  const skillIds = frozenApplication
    ? [...new Set(frozenApplication.agents.flatMap((agent) =>
      agent.skillRevisions.map((skill) => skill.skillId)))]
    : [...new Set(roleRows.flatMap((role) => {
      const ids = parse(role.skill_ids, []) as unknown[];
      return ids.map(String);
    }))];
  const skillRevisions = frozenApplication
    ? frozenApplication.agents.flatMap((agent) => agent.skillRevisions.map((skill) => ({
      id: skill.skillId,
      active_revision_id: skill.revisionId,
      content_hash: skill.contentHash,
      agent_id: agent.agentId,
      updated_at: undefined,
    })))
    : skillIds.length
      ? rows(`SELECT id,active_revision_id,updated_at FROM skill WHERE id IN (${skillIds.map(() => '?').join(',')}) ORDER BY id`, ...skillIds)
      : [];
  const revision = frozenApplication?.codeRevision ?? gitRevision(conversation.project_path);
  const executionAccountIds = frozenApplication
    ? [...new Set(frozenApplication.agents.flatMap((agent) => agent.accountId ? [agent.accountId] : []))]
    : [...new Set(invocations.map((item) => item.account_id).filter(Boolean).map(String))];
  const accountById = frozenApplication ? new Map() : new Map(listAccounts().map((account) => [account.id, account]));
  const executionAccountConfigs = frozenApplication
    ? [...new Map(frozenApplication.agents.flatMap((agent) => agent.accountId ? [[agent.accountId, {
      accountId: agent.accountId,
      configDigest: agent.accountConfigDigest,
    }] as const] : [])).values()]
    : executionAccountIds.flatMap((accountId) => {
      const account = accountById.get(accountId);
      return account ? [{
        accountId,
        configDigest: digest({
          provider: account.provider,
          authMode: account.authMode,
          baseUrl: account.baseUrl,
          models: account.models,
        }),
      }] : [];
    });
  const executionProvenance = offlineProvenance?.execution;
  const frozenManifestDigest = frozenApplication ? digest(frozenApplication) : undefined;
  const missing: string[] = [];
  if (tasks.length === 0) missing.push('tasks');
  if (spans.length === 0) missing.push('spans');
  if (proofs.length === 0) missing.push('proofs');
  if (chains.length > 0 && passes.length === 0) missing.push('handoff_receipts');
  if (lateFacts.length > 0) missing.push('mutable_state_at_cutoff');
  if (!revision) missing.push('code_revision');
  if (frozenApplication ? frozenApplication.team.roles.length === 0 : !conversation.team_pack_id || roleRows.length === 0) {
    missing.push('team_configuration_revision');
  }
  if (skillIds.length && skillRevisions.some((skill) => !skill.active_revision_id)) missing.push('skill_revision');
  if (executionAccountConfigs.length !== executionAccountIds.length) missing.push('model_configuration_revision');
  const byDimension: Record<string, number> = {
    completion: tasks.length ? 1 : 0,
    delivery: taskActions.length || artifacts.length ? 1 : 0,
    reliability: invocations.length && !lateFacts.some((fact) => fact.startsWith('invocation:')) ? 1 : 0,
    efficiency: spans.some((span) => span.kind === 'tool') ? 1 : 0,
    correctness: messages.length || payloads.length ? 1 : 0,
    instruction_following: messages.length || payloads.length ? 1 : 0,
    collaboration: lateFacts.some((fact) => fact.startsWith('pass:') || fact.startsWith('pass_group:'))
      ? 0 : chains.length ? (passes.length ? 1 : 0) : 1,
    clarity: messages.length || payloads.length ? 1 : 0,
    configuration: revision && (frozenApplication?.team.id ?? conversation.team_pack_id) &&
      (frozenApplication?.team.roles.length ?? roleRows.length) &&
      executionAccountConfigs.length === executionAccountIds.length ? 1 : 0,
  };
  const coverage = Object.values(byDimension).reduce((sum, value) => sum + value, 0) / Object.keys(byDimension).length;
  const evidence = {
    conversation: cleanRow(conversation), tasks, edges, taskActions, artifacts, spans, payloads, proofs,
    messages, contracts, chains, passGroups, passes, collaborationEvents, invocations, lateFacts,
    evaluationCase: evaluationCase ? cleanRow(evaluationCase) : undefined,
  };
  const truncated = collectTruncatedPaths(evidence);
  for (const payload of payloads.filter((item) => Boolean(item.truncated))) {
    truncated.push(`$.payloads.${String(payload.span_id)}:${String(payload.role)}:${String(payload.seq)}`);
  }
  const evidenceRefs: EvidenceRef[] = [
    ...tasks.map((task) => ({ kind: 'task', id: String(task.id), taskId: String(task.id) })),
    ...spans.map((span) => ({ kind: 'span', id: String(span.span_id), traceId: String(span.trace_id), taskId: span.task_id ? String(span.task_id) : undefined })),
    ...proofs.map((proof) => ({
      kind: 'proof', id: String(proof.id),
      taskId: proof.task_id ? String(proof.task_id) : undefined,
      chainId: proof.chain_id ? String(proof.chain_id) : undefined,
    })),
    ...messages.map((message) => ({ kind: 'message', id: String(message.id), taskId: message.task_id ? String(message.task_id) : undefined })),
    ...passes.map((pass) => ({
      kind: 'pass', id: String(pass.id), passId: String(pass.id),
      chainId: pass.chain_id ? String(pass.chain_id) : undefined,
    })),
    ...passGroups.map((group) => ({
      kind: 'pass_group', id: String(group.id),
      chainId: group.chain_id ? String(group.chain_id) : undefined,
    })),
    ...collaborationEvents.map(collaborationEventEvidenceRef),
    ...taskActions.map((action) => ({ kind: 'action', id: String(action.id) })),
    ...artifacts.map((artifact) => ({ kind: 'artifact', id: String(artifact.id), taskId: String(artifact.task_id) })),
  ];
  const appManifest = {
    gitRevision: revision,
    teamPackId: frozenApplication?.team.id ?? conversation.team_pack_id ?? undefined,
    roleCardSnapshots: frozenApplication
      ? frozenApplication.team.roles.map((role) => ({
        roleId: role.id,
        roleCardId: role.roleCardId,
        snapshotDigest: role.roleCardSnapshot ? digest(role.roleCardSnapshot) : undefined,
        accountIds: role.accountIds ?? [],
        skillIds: role.skillIds ?? [],
      }))
      : roleRows.map((role) => ({
        roleId: role.role_id, roleCardId: role.role_card_id,
        snapshotDigest: role.role_card_snapshot ? digest(parse(role.role_card_snapshot, {})) : undefined,
        accountIds: parse(role.account_ids, []), skillIds: parse(role.skill_ids, []),
      })),
    skillRevisions: skillRevisions.map((skill) => ({
      skillId: skill.id,
      revisionId: skill.active_revision_id,
      contentHash: skill.content_hash,
      agentId: skill.agent_id,
      fallbackUpdatedAt: skill.updated_at,
    })),
    executionAccounts: executionAccountIds,
    executionAccountConfigs,
    engines: frozenApplication
      ? [...new Set(frozenApplication.agents.map((agent) => agent.engine))]
      : [...new Set(invocations.map((item) => item.engine).filter(Boolean))],
    rubricRevisionId: DEFAULT_RUBRIC_REVISION_ID,
    evaluatorBundleDigest: digest(EVALUATOR_BUNDLE_REVISION),
    evaluationCaseId: request.caseId,
    applicationVariant: frozenApplication ?? request.applicationManifest,
    applicationSnapshotId: executionProvenance?.application_snapshot_id,
    targetManifestDigest: executionProvenance?.target_manifest_digest ?? frozenManifestDigest,
    observedManifestDigest: executionProvenance?.observed_manifest_digest,
  };
  const hashInput = {
    subject: {
      conversationId: request.conversationId, rootTaskId: request.rootTaskId ?? null,
      chainId: request.chainId ?? null, evidenceCutoffAt: cutoff,
      taskType: request.taskType ?? 'unknown', difficulty: request.difficulty ?? 'unknown',
      language: request.language ?? 'unknown', caseId: request.caseId ?? null,
    },
    evidence,
    appManifest,
  };
  return {
    id: `snapshot-${randomUUID()}`,
    conversationId: request.conversationId,
    rootTaskId: request.rootTaskId,
    chainId: request.chainId,
    mode: request.mode ?? 'online',
    evidenceCutoffAt: cutoff,
    collectedAt: new Date().toISOString(),
    snapshotHash: digest(hashInput),
    evidenceRefs,
    evidence,
    appManifest,
    dataQuality: { coverage, missing, truncated: [...new Set(truncated)], byDimension },
    taskType: request.taskType ?? 'unknown',
    difficulty: request.difficulty ?? 'unknown',
    language: request.language ?? 'unknown',
  };
}
