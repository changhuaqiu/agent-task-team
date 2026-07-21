import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProjectContextService } from './project-context-service';

const runBenchmark = process.env.RUN_PROJECT_CONTEXT_BENCHMARK === '1'
  ? describe
  : describe.skip;
const AGENT_RUNS = 8;
let temporaryRoot: string | undefined;

interface BaselineRun {
  entriesVisited: number;
  filesRead: number;
  bytesRead: number;
  promptChars: number;
  durationMs: number;
}

function writeFixture(root: string, relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

function createFixture(root: string): string[] {
  writeFixture(root, 'package.json', JSON.stringify({
    name: 'project-context-benchmark-fixture',
    scripts: {
      build: 'tsc --noEmit',
      test: 'vitest run',
      lint: 'eslint .',
      dev: 'next dev',
    },
    dependencies: { next: '16.2.4', react: '19.2.4' },
  }, null, 2));
  writeFixture(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  writeFixture(root, 'AGENTS.md', [
    '# Agent instructions',
    '',
    'Read docs/standards first. Run focused tests. Preserve public API compatibility.',
  ].join('\n'));
  writeFixture(root, 'docs/standards/testing.md', [
    '# Testing standard',
    '',
    'Every contribution requires deterministic unit tests and impact evidence.',
    '',
    'Focused tests run before the production build.',
  ].join('\n'));
  writeFixture(root, 'docs/security/authentication.md', [
    '# Authentication security',
    '',
    'Login, session and token changes require threat-model evidence and regression tests.',
    '',
    'authentication login session token security '.repeat(80),
  ].join('\n'));
  writeFixture(root, 'docs/architecture/database.md', [
    '# Database architecture',
    '',
    'Schema migrations are forward-only and preserve transaction boundaries.',
    '',
    'database schema migration sqlite transaction '.repeat(80),
  ].join('\n'));
  writeFixture(root, 'docs/technical/evaluation/accessibility-evaluation.md', [
    '# Frontend accessibility evaluation',
    '',
    'The benchmark checks keyboard navigation, labels and automated accessibility assertions.',
    '',
    'frontend accessibility evaluation keyboard aria '.repeat(80),
  ].join('\n'));
  writeFixture(root, 'docs/runbook/deployment.md', [
    '# Deployment and rollback',
    '',
    'Release automation must retain a tested rollback command and deployment receipt.',
    '',
    'deployment release rollback operations receipt '.repeat(80),
  ].join('\n'));
  for (let index = 0; index < 36; index += 1) {
    writeFixture(root, `docs/wiki/domain-${String(index).padStart(2, '0')}.md`, [
      `# Domain note ${index}`,
      '',
      `Background domain knowledge for subsystem ${index}.`,
      '',
      `subsystem-${index} behavior ownership contract `.repeat(60),
    ].join('\n'));
  }

  const specialModules: Array<[string, string]> = [
    ['src/auth/login.ts', 'export function authenticate(token: string) { return token.length > 0; }'],
    ['src/db/migration.ts', 'export function migrateSchema(version: number) { return version + 1; }'],
    ['src/ui/accessibility.ts', 'export const ariaPolicy = "required";'],
    ['src/deploy/rollback.ts', 'export function rollbackRelease() { return true; }'],
    ['src/testing/contract.ts', 'export const deterministicTests = true;'],
  ];
  for (const [modulePath, content] of specialModules) writeFixture(root, modulePath, content);
  for (let index = 0; index < 240; index += 1) {
    const previous = index > 0
      ? `import { module${index - 1} } from './module-${String(index - 1).padStart(3, '0')}';\n`
      : '';
    writeFixture(root, `src/modules/module-${String(index).padStart(3, '0')}.ts`, [
      previous,
      `export function module${index}(input: number): number {`,
      `  return input + ${index}${index > 0 ? ` + module${index - 1}(0)` : ''};`,
      '}',
      `export const moduleTag${index} = 'subsystem-${index}';`,
    ].join('\n'));
  }
  writeFixture(root, 'src/index.ts', [
    "import { authenticate } from './auth/login';",
    "import { migrateSchema } from './db/migration';",
    'export function main(token: string) {',
    '  return authenticate(token) && migrateSchema(1) > 1;',
    '}',
  ].join('\n'));
  return [
    'docs/security/authentication.md',
    'docs/architecture/database.md',
    'docs/technical/evaluation/accessibility-evaluation.md',
    'docs/runbook/deployment.md',
    'docs/standards/testing.md',
  ];
}

function hashFiles(root: string, relativePaths: string[]): Record<string, string> {
  return Object.fromEntries(relativePaths.map(relativePath => [
    relativePath,
    createHash('sha256')
      .update(readFileSync(path.join(root, ...relativePath.split('/'))))
      .digest('hex'),
  ]));
}

function baselineDiscover(root: string): BaselineRun {
  const started = performance.now();
  const parts: string[] = [];
  let entriesVisited = 0;
  let filesRead = 0;
  let bytesRead = 0;
  const ignored = new Set(['.git', '.ath', 'node_modules', '.next', 'dist', 'build', 'coverage']);

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });
    entriesVisited += entries.length;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) visit(target);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(root, target).replaceAll('\\', '/');
      const extension = path.extname(relativePath).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.md', '.mdx', '.json', '.yaml'].includes(extension)) {
        continue;
      }
      const buffer = readFileSync(target);
      const content = buffer.subarray(0, 24_000).toString('utf8');
      filesRead += 1;
      bytesRead += Math.min(buffer.byteLength, 24_000);
      parts.push(`## ${relativePath}\n${content}`);
    }
  }

  visit(root);
  return {
    entriesVisited,
    filesRead,
    bytesRead,
    promptChars: parts.join('\n').length,
    durationMs: Number((performance.now() - started).toFixed(3)),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(3))
    : sorted[middle];
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function reduction(before: number, after: number): number {
  return Number(((1 - after / before) * 100).toFixed(2));
}

afterAll(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
});

runBenchmark('project context deterministic benchmark', () => {
  it('writes raw before/after evidence from a fixed fixture', async () => {
    temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'project-context-benchmark-'));
    const ownerDocuments = createFixture(temporaryRoot);
    const ownerHashesBefore = hashFiles(temporaryRoot, ownerDocuments);

    const baselineRuns = Array.from({ length: AGENT_RUNS }, () => baselineDiscover(temporaryRoot!));
    const service = new ProjectContextService();
    const conversation = {
      id: 'benchmark-primary',
      title: 'Benchmark workstream',
      goal: 'Improve authentication, database, accessibility and deployment behavior',
      status: 'active',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
    };
    const queryCases = [
      { query: 'authentication security login token', expected: 'docs/security/authentication.md' },
      { query: 'database schema migration transaction', expected: 'docs/architecture/database.md' },
      { query: 'frontend accessibility evaluation keyboard', expected: 'docs/technical/evaluation/accessibility-evaluation.md' },
      { query: 'deployment release rollback receipt', expected: 'docs/runbook/deployment.md' },
      { query: 'contribution deterministic test standard', expected: 'docs/standards/testing.md' },
    ];

    const coldStarted = performance.now();
    const cold = await service.prepare({
      mode: 'initialize',
      projectPath: temporaryRoot,
      conversation,
      requestText: queryCases[0].query,
    });
    const coldWallMs = Number((performance.now() - coldStarted).toFixed(3));
    const warmResults = [];
    const warmWallMs: number[] = [];
    for (let index = 1; index < AGENT_RUNS; index += 1) {
      const started = performance.now();
      warmResults.push(await service.prepare({
        mode: 'load',
        projectPath: temporaryRoot,
        conversation,
        requestText: queryCases[index % queryCases.length].query,
      }));
      warmWallMs.push(Number((performance.now() - started).toFixed(3)));
    }

    const recallResults = [];
    for (const item of queryCases) {
      const result = await service.prepare({
        mode: 'load',
        projectPath: temporaryRoot,
        conversation,
        requestText: item.query,
      });
      const selected = result.capsule?.selectedKnowledge.map(entry => entry.path) ?? [];
      recallResults.push({
        ...item,
        selected,
        hit: selected.includes(item.expected),
      });
    }

    const secondConversation = {
      id: 'benchmark-handoff',
      title: 'Handoff workstream',
      goal: 'Continue database migration work',
      status: 'active',
      createdAt: '2026-07-20T01:00:00.000Z',
      updatedAt: '2026-07-20T01:00:00.000Z',
    };
    const handoff = await service.prepare({
      mode: 'load',
      projectPath: temporaryRoot,
      conversation: secondConversation,
      workstreams: [conversation, secondConversation],
      requestText: 'database migration handoff',
    });
    appendFileSync(
      path.join(temporaryRoot, 'src/auth/login.ts'),
      '\nexport const authenticationRevision = 2;\n',
      'utf8',
    );
    const staleStarted = performance.now();
    const stale = await service.prepare({
      mode: 'load',
      projectPath: temporaryRoot,
      conversation,
      workstreams: [conversation, secondConversation],
      requestText: 'authentication revision',
    });
    const staleWallMs = Number((performance.now() - staleStarted).toFixed(3));
    const ownerHashesAfter = hashFiles(temporaryRoot, ownerDocuments);
    const warmFilesRead = warmResults.map(result => result.diagnostics.filesRead);
    const warmBytesRead = warmResults.map(result => result.diagnostics.bytesRead);
    const warmEntries = warmResults.map(result => result.diagnostics.entriesVisited);
    const warmPromptChars = warmResults.map(result => result.capsule?.content.length ?? 0);
    const baselineTotals = {
      entriesVisited: sum(baselineRuns.map(result => result.entriesVisited)),
      filesRead: sum(baselineRuns.map(result => result.filesRead)),
      bytesRead: sum(baselineRuns.map(result => result.bytesRead)),
      promptChars: sum(baselineRuns.map(result => result.promptChars)),
      estimatedTokens: Math.ceil(sum(baselineRuns.map(result => result.promptChars)) / 4),
      durationMs: Number(sum(baselineRuns.map(result => result.durationMs)).toFixed(3)),
    };
    const candidateTotals = {
      entriesVisited: cold.diagnostics.entriesVisited + sum(warmEntries),
      filesRead: cold.diagnostics.filesRead + sum(warmFilesRead),
      bytesRead: cold.diagnostics.bytesRead + sum(warmBytesRead),
      promptChars: (cold.capsule?.content.length ?? 0) + sum(warmPromptChars),
      estimatedTokens: Math.ceil(((cold.capsule?.content.length ?? 0) + sum(warmPromptChars)) / 4),
      durationMs: Number((coldWallMs + sum(warmWallMs)).toFixed(3)),
    };
    const raw = {
      schemaVersion: 1,
      changeId: 'CE-20260720-project-context-bootstrap',
      evaluatorRevision: 'project-context-benchmark-v1',
      generatedAt: new Date().toISOString(),
      environment: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        cpu: os.cpus()[0]?.model ?? 'unknown',
        logicalCpuCount: os.cpus().length,
        agentRuns: AGENT_RUNS,
        fixture: {
          sourceModules: cold.topology?.modules.length ?? 0,
          dependencyEdges: cold.topology?.edges.length ?? 0,
          knowledgeDocuments: cold.manifest?.knowledge.length ?? 0,
        },
      },
      baseline: {
        model: 'each agent recursively enumerates and reads all candidate source/docs',
        perAgentMedian: {
          entriesVisited: median(baselineRuns.map(result => result.entriesVisited)),
          filesRead: median(baselineRuns.map(result => result.filesRead)),
          bytesRead: median(baselineRuns.map(result => result.bytesRead)),
          promptChars: median(baselineRuns.map(result => result.promptChars)),
          estimatedTokens: Math.ceil(median(baselineRuns.map(result => result.promptChars)) / 4),
          durationMs: median(baselineRuns.map(result => result.durationMs)),
        },
        totals: baselineTotals,
      },
      candidate: {
        model: 'one bounded index plus request-aware capsule and finite freshness checks',
        cold: {
          ...cold.diagnostics,
          wallDurationMs: coldWallMs,
          promptChars: cold.capsule?.content.length ?? 0,
          estimatedTokens: Math.ceil((cold.capsule?.content.length ?? 0) / 4),
          revision: cold.manifest?.revision,
        },
        warmMedian: {
          entriesVisited: median(warmEntries),
          filesRead: median(warmFilesRead),
          bytesRead: median(warmBytesRead),
          promptChars: median(warmPromptChars),
          estimatedTokens: Math.ceil(median(warmPromptChars) / 4),
          durationMs: median(warmWallMs),
        },
        totals: candidateTotals,
      },
      comparison: {
        amortizedAcrossAgents: {
          entriesVisitedReductionPct: reduction(
            baselineTotals.entriesVisited,
            candidateTotals.entriesVisited,
          ),
          filesReadReductionPct: reduction(baselineTotals.filesRead, candidateTotals.filesRead),
          bytesReadReductionPct: reduction(baselineTotals.bytesRead, candidateTotals.bytesRead),
          promptCharsReductionPct: reduction(
            baselineTotals.promptChars,
            candidateTotals.promptChars,
          ),
          estimatedTokensReductionPct: reduction(
            baselineTotals.estimatedTokens,
            candidateTotals.estimatedTokens,
          ),
          durationReductionPct: reduction(
            baselineTotals.durationMs,
            candidateTotals.durationMs,
          ),
        },
        warmVsBaselinePerAgent: {
          filesReadReductionPct: reduction(
            median(baselineRuns.map(result => result.filesRead)),
            median(warmFilesRead),
          ),
          bytesReadReductionPct: reduction(
            median(baselineRuns.map(result => result.bytesRead)),
            median(warmBytesRead),
          ),
          promptCharsReductionPct: reduction(
            median(baselineRuns.map(result => result.promptChars)),
            median(warmPromptChars),
          ),
          durationReductionPct: reduction(
            median(baselineRuns.map(result => result.durationMs)),
            median(warmWallMs),
          ),
        },
        coldDurationOverheadPct: Number((
          (coldWallMs / median(baselineRuns.map(result => result.durationMs)) - 1) * 100
        ).toFixed(2)),
      },
      relevance: {
        k: 5,
        recallAtK: Number((
          recallResults.filter(result => result.hit).length / recallResults.length
        ).toFixed(3)),
        cases: recallResults,
      },
      handoff: {
        sharedRevisionReused: handoff.manifest?.revision === cold.manifest?.revision,
        cacheHit: handoff.diagnostics.cacheHit,
        siblingFieldWhitelist: Object.keys(handoff.capsule?.siblingWorkstreams[0] ?? {}).sort(),
      },
      staleRefresh: {
        cacheHit: stale.diagnostics.cacheHit,
        previousRevision: handoff.manifest?.revision,
        refreshedRevision: stale.manifest?.revision,
        revisionIncremented: (
          stale.manifest?.revision === (handoff.manifest?.revision ?? 0) + 1
        ),
        filesRead: stale.diagnostics.filesRead,
        bytesRead: stale.diagnostics.bytesRead,
        durationMs: staleWallMs,
      },
      integrity: {
        ownerDocumentsUnchanged: JSON.stringify(ownerHashesBefore) === JSON.stringify(ownerHashesAfter),
        warmDiagnosticsIncludePreflightIO: warmResults.every(result => (
          result.diagnostics.entriesVisited > result.diagnostics.freshnessChecks
          && result.diagnostics.filesRead >= 2
          && result.diagnostics.bytesRead > 0
        )),
        ownerHashesBefore,
        ownerHashesAfter,
      },
      thresholds: {
        warmFilesReadReductionAtLeast80Pct: reduction(
          median(baselineRuns.map(result => result.filesRead)),
          median(warmFilesRead),
        ) >= 80,
        warmBytesReadReductionAtLeast80Pct: reduction(
          median(baselineRuns.map(result => result.bytesRead)),
          median(warmBytesRead),
        ) >= 80,
        recallAt5EqualsOne: recallResults.every(result => result.hit),
        handoffSharedRevision: handoff.manifest?.revision === cold.manifest?.revision,
        staleChangeIncrementsRevision: (
          stale.manifest?.revision === (handoff.manifest?.revision ?? 0) + 1
        ),
        ownerDocumentsUnchanged: JSON.stringify(ownerHashesBefore) === JSON.stringify(ownerHashesAfter),
        warmDiagnosticsIncludePreflightIO: warmResults.every(result => (
          result.diagnostics.entriesVisited > result.diagnostics.freshnessChecks
          && result.diagnostics.filesRead >= 2
          && result.diagnostics.bytesRead > 0
        )),
      },
    };

    const outputPath = path.resolve(
      process.env.PROJECT_CONTEXT_BENCHMARK_OUTPUT
        ?? 'docs/technical/evaluation/data/project-context-bootstrap-benchmark.json',
    );
    mkdirSync(path.dirname(outputPath), { recursive: true });
    const canonicalDigest = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    const artifact = {
      ...raw,
      artifactDigest: {
        algorithm: 'sha256',
        scope: 'canonical JSON before artifactDigest field',
        value: canonicalDigest,
      },
    };
    writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

    expect(raw.relevance.recallAtK).toBe(1);
    expect(Object.values(raw.thresholds).every(Boolean)).toBe(true);
    expect(statSync(outputPath).size).toBeGreaterThan(0);
  });
});
