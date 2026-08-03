import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createBackend, loadCatalog } from './catalog';
import { createAutonomousWorkPermissionPolicy } from './permissionPolicy';

const runReal = process.env.RUN_REAL_CLAUDE_ACP === '1';
const suite = runReal ? describe : describe.skip;

suite('Claude ACP autonomous permission compatibility (real runtime)', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ath-claude-permission-'));

  afterAll(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(cwd, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  });

  it('allows a contract-authorized file edit and local verification without interactive input', async () => {
    const entry = loadCatalog().find((candidate) => candidate.id === 'claude');
    expect(entry).toBeDefined();
    const requestedKinds: string[] = [];
    const decisions: string[] = [];
    const backend = createBackend(entry!, {
      cwd,
      permissionPolicy: createAutonomousWorkPermissionPolicy({
        cwd,
        engine: 'claude',
        isAuthorityActive: () => true,
        permissions: {
          authorization: {
            allowCodeChanges: true,
            allowPush: false,
            allowPullRequest: false,
            allowAutoMerge: false,
          },
        },
      }),
      onPermissionRequested: (request) => {
        requestedKinds.push(request.toolCall.kind ?? 'unknown');
      },
      onPermissionResolved: (_request, response) => {
        decisions.push(response.outcome.outcome === 'selected' ? response.outcome.optionId : 'cancelled');
      },
      timeoutMs: 180_000,
      maxTurnTimeoutMs: 240_000,
    });

    const run = backend.execute(
      'Use the Write tool to create permission-proof.test.cjs containing a Node test that asserts the string autonomous-ok equals autonomous-ok. '
      + 'Then use Bash to run exactly: node --test permission-proof.test.cjs. '
      + 'Finish with a short confirmation.',
      {},
    );
    for await (const event of run.events) void event;
    const result = await run.result;

    expect(result.status).toBe('completed');
    expect(existsSync(join(cwd, 'permission-proof.test.cjs'))).toBe(true);
    expect(readFileSync(join(cwd, 'permission-proof.test.cjs'), 'utf8')).toContain('autonomous-ok');
    expect(requestedKinds).toEqual(expect.arrayContaining(['edit', 'execute']));
    expect(decisions.length).toBe(requestedKinds.length);
    expect(decisions.every((decision) => decision === 'allow')).toBe(true);
  }, 300_000);
});
