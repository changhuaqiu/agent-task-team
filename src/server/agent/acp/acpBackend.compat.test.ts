// src/server/agent/acp/acpBackend.compat.test.ts
//
// Task 9 — 3-runtime compatibility suite (spec §8 acceptance automation).
//
// Spec §8 mandates automated tests for: session, cancel, permission, tool
// event, failure recovery, and process exit. This file covers the
// DETERMINISTIC, runtime-agnostic scenarios (cancel / timeout / abnormal-exit)
// against the mock ACP agent acting as a stand-in for ANY ACP runtime.
//
// The contract under test is `AcpBackend`'s behavior — which is identical
// regardless of which runtime (opencode / claude / codex) sits on the other
// end of the JSON-RPC stream, because AcpBackend only speaks ACP. So a
// mock-based suite is the right altitude for these scenarios: deterministic,
// fast, and free of the real-runtimes' env/API/speed constraints.
//
// Coverage map (spec §8):
//   - session          → mockAcpAgent.test.ts + acpBackend.test.ts (newSession)
//   - permission       → mockAcpAgent.test.ts (allow/reject) + acpBackend.test.ts
//                        (explicit allow-once → tool_result). DENY is covered;
//                        interactive CONFIRM remains a later profile.
//   - tool event       → mockAcpAgent.test.ts + acpBackend.test.ts (tool_use/
//                        tool_result).
//   - cancel           → THIS FILE (scenario "slow" + kill()).
//   - timeout          → THIS FILE (scenario "slow" + timeoutMs).
//   - failure recovery → THIS FILE (scenario "error" → abnormal exit → failed).
//   - process exit     → covered by all three above (the close handler is the
//                        single abnormal-exit resolver; each path exercises it).
//
// Per-runtime basic acceptance (a real turn completes on each runtime) is
// proven by the Task 6/7 smokes (scripts/smoke-acp-runtime.ts) — NOT re-run
// here, because real-runtimes × many scenarios × real API calls would be slow,
// flaky, and env-gated, with no extra contract coverage.
//
// Resume is covered by acpBackend.test.ts, including load failure and identity
// mismatch. Deferred this iteration (documented, not built):
//   - permission confirm: policy selection is non-interactive in this iteration
//     and therefore has no user-prompting profile to exercise yet.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { afterEach, describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { AcpBackend, getActiveAcpRunCount } from './acpBackend';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const mockPath = join(__dirname, 'mockAcpAgent.ts');
const tempDirs = new Set<string>();

afterEach(async () => {
  const deadline = Date.now() + 5_000;
  while (getActiveAcpRunCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (process.platform === 'win32') {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  for (const path of tempDirs) {
    rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    tempDirs.delete(path);
  }
});

/**
 * Build an AcpBackend that spawns the mock ACP agent in the given scenario.
 * Uses an isolated temp cwd (the mock doesn't read it, but AcpBackend passes
 * it to spawn). `extraEnv` is merged on top of process.env via AcpBackend's
 * `env` opt (which it forwards to the child process).
 */
function makeMockBackend(
  scenario: 'normal' | 'slow' | 'active' | 'error',
  opts: { timeoutMs?: number; maxTurnTimeoutMs?: number } = {},
): AcpBackend {
  const cwd = mkdtempSync(join(tmpdir(), 'acp-compat-'));
  tempDirs.add(cwd);
  return new AcpBackend({
    // Node 24 executes erasable TypeScript directly. Avoiding the npx → tsx
    // launcher removes unrelated startup variance from timeout semantics.
    command: process.execPath,
    args: [mockPath],
    engine: 'opencode',
    cwd,
    env: { MOCK_ACP_SCENARIO: scenario },
    permissionPolicy: 'allow_once',
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.maxTurnTimeoutMs !== undefined ? { maxTurnTimeoutMs: opts.maxTurnTimeoutMs } : {}),
  });
}

/**
 * Drain `run.events` to completion and collect the event types. Returns the
 * collected types + the resolved AgentResult. Draining is required so the
 * generator's `finally` runs (clearTimeout + killProcess) and the
 * AcpBackend emits the terminal `done` at its own boundary.
 */
async function drain(run: {
  events: AsyncGenerator<{ type: string }>;
  result: Promise<{ status: string; error?: string }>;
}) {
  const types: string[] = [];
  for await (const event of run.events) {
    types.push(event.type);
  }
  const result = await run.result;
  return { types, result };
}

describe('AcpBackend compatibility suite (spec §8: cancel / timeout / failure)', () => {
  // ---------------------------------------------------------------------------
  // cancel 回收 (spec §8): kill() mid-turn → 'cancelled' + done + no zombie.
  // ---------------------------------------------------------------------------
  it('cancel: kill() mid-turn resolves cancelled and emits done (no zombie)', async () => {
    // "slow" blocks for 60s after the opening text, so kill() at 1000ms always
    // wins the race. Default timeout is 120s — comfortably longer than the
    // kill window.
    const backend = makeMockBackend('slow');

    const run = backend.execute('hi', {});

    // Give the agent time to start the turn and emit the opening text, then
    // kill mid-turn (while it's blocked in the slow scenario's 60s sleep).
    // 1000ms accommodates `npx tsx` startup + initialize + session/new + the
    // first agent_message_chunk.
    await new Promise((r) => setTimeout(r, 1000));
    expect(() => run.kill()).not.toThrow();

    const { types, result } = await drain(run);

    expect(types.filter((type) => type === 'done')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');

    // Cause-based close handler (Task 5 fix): kill() sets the `killed` flag →
    // the close handler resolves 'cancelled', deterministically.
    expect(result.status).toBe('cancelled');

    // The result resolved at all => the close handler fired => the process
    // exited (no zombie). tree-kill guarantees the child is reaped.
    expect(result.error).toBe('killed by caller');
  }, 15000);

  // ---------------------------------------------------------------------------
  // timeout (spec §8): timeoutMs fires mid-turn → 'timeout' (not killed).
  // ---------------------------------------------------------------------------
  it('timeout: short timeoutMs mid-turn resolves timeout and emits done', async () => {
    // "slow" blocks for 60s. A 500ms backend timeout fires well before that —
    // the timer wins, sets `timedOut`, and killProcess() triggers close whose
    // handler resolves 'timeout'.
    const backend = makeMockBackend('slow', { timeoutMs: 500 });

    const run = backend.execute('hi', {});

    const { types, result } = await drain(run);

    expect(types.filter((type) => type === 'done')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');
    // Timer wins → timedOut flag → close handler resolves 'timeout'.
    expect(result.status).toBe('timeout');
    expect(result.error).toContain('timed out');
    expect(result.reasonCode).toBe('acp_timeout');
  }, 15000);

  it('idle timeout renews while ACP updates continue', async () => {
    const backend = makeMockBackend('active', {
      timeoutMs: 1_500,
      maxTurnTimeoutMs: 10_000,
    });
    const startedAt = Date.now();
    const { result } = await drain(backend.execute('hi', {}));

    expect(Date.now() - startedAt).toBeGreaterThan(1_500);
    expect(result.status).toBe('completed');
    expect(result.reasonCode).toBeUndefined();
  }, 15000);

  it('hard max ends a turn that remains active but never completes in time', async () => {
    const backend = makeMockBackend('active', {
      timeoutMs: 1_500,
      maxTurnTimeoutMs: 1_000,
    });
    const { types, result } = await drain(backend.execute('hi', {}));

    expect(types.filter((type) => type === 'done')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');
    expect(result.status).toBe('timeout');
    expect(result.reasonCode).toBe('acp_max_turn_timeout');
    expect(result.error).toContain('hard limit');
  }, 15000);

  // ---------------------------------------------------------------------------
  // 异常退出 / failure recovery (spec §8): agent exits mid-turn → 'failed'.
  // ---------------------------------------------------------------------------
  it('failure recovery: abnormal process exit mid-turn resolves failed with error', async () => {
    // "error" emits the opening text then process.exit(1) mid-turn. The close
    // handler fires with a non-zero exit code and no kill/timeout cause flags
    // → resolves 'failed'. An `error` event is pushed before the result.
    const backend = makeMockBackend('error');

    const run = backend.execute('hi', {});

    const { types, result } = await drain(run);

    // The abnormal-exit path pushes an `error` event before resolving.
    // (The stream closing mid-turn makes connectWith reject → the .catch
    // handler pushes an error event and resolves 'failed'. The subsequent
    // `close` handler is a no-op since resultResolved is already true. Both
    // paths yield 'failed' — the contract under test.)
    expect(types).toContain('error');
    // Final terminal event still emits.
    expect(types.filter((type) => type === 'done')).toHaveLength(1);
    expect(types.at(-1)).toBe('done');

    // No kill, no timeout → resolves 'failed'.
    expect(result.status).toBe('failed');
    // An error message describing the failure is present.
    expect(result.error).toBeTruthy();
  }, 15000);
});
