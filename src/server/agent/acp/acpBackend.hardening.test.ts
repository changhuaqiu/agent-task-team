import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AcpBackend,
  getActiveAcpRunCount,
  type AcpBackendOpts,
} from './acpBackend';

const mockPath = join(dirname(fileURLToPath(import.meta.url)), '../../../test-helpers/acp/mockAcpAgent.ts');
const tsxCliPath = fileURLToPath(import.meta.resolve('tsx/cli'));
const tempDirs = new Set<string>();

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), 'acp-hardening-'));
  tempDirs.add(path);
  return path;
}

function backend(
  scenario: 'normal' | 'slow' | 'active' | 'error' | 'startup_abort' | 'flood' | 'large' | 'wrong_session',
  overrides: Partial<AcpBackendOpts> = {},
) {
  return new AcpBackend({
    command: process.execPath,
    args: [tsxCliPath, mockPath],
    engine: 'opencode',
    cwd: makeTempDir(),
    env: { MOCK_ACP_SCENARIO: scenario },
    permissionPolicy: 'allow_once',
    ...overrides,
  });
}

async function drain(run: ReturnType<AcpBackend['execute']>) {
  const events = [];
  for await (const event of run.events) events.push(event);
  return { events, result: await run.result };
}

async function waitForNoActiveRuns(timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (getActiveAcpRunCount() > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  if (getActiveAcpRunCount() > 0) {
    throw new Error(`ACP test leaked ${getActiveAcpRunCount()} active run(s) after ${timeoutMs}ms`);
  }
}

describe('AcpBackend hardening', () => {
  afterEach(async () => {
    await waitForNoActiveRuns();
    if (process.platform === 'win32') {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    for (const path of tempDirs) {
      rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      tempDirs.delete(path);
    }
  });

  it('returns a structured spawn failure instead of throwing', async () => {
    const run = new AcpBackend({
      command: 'definitely-not-an-acp-command',
      args: [],
      engine: 'opencode',
      cwd: process.cwd(),
    }).execute('hello', {});

    const { events, result } = await drain(run);
    expect(events.some((event) => event.type === 'error')).toBe(true);
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'acp_startup_failed' });
  });

  it('preserves subprocess exit and stderr diagnostics when the ACP handshake breaks', async () => {
    const run = backend('startup_abort').execute('hello', {});
    const { events, result } = await drain(run);
    const diagnostic = `${result.error ?? ''}\n${events.map((event) => event.content).join('\n')}`;

    expect(result).toMatchObject({ status: 'failed', reasonCode: 'acp_startup_failed' });
    expect(diagnostic).toContain('ACP connection failed');
    expect(diagnostic).toContain('code 23');
    expect(diagnostic).toContain('adapter bootstrap failed before ACP handshake');
  }, 15_000);

  it('resolves cancellation independently of the child close event', async () => {
    const run = backend('slow', { cancelGraceMs: 250 }).execute('hello', {});
    const started = Date.now();
    run.kill();
    const result = await run.result;
    expect(Date.now() - started).toBeLessThan(200);
    expect(result).toMatchObject({ status: 'cancelled', reasonCode: 'acp_cancelled' });
    await drain(run);
  });

  it('cancels the run when an event consumer stops early', async () => {
    const run = backend('slow').execute('hello', {});
    const iterator = run.events[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    await expect(run.result).resolves.toMatchObject({
      status: 'cancelled',
      reasonCode: 'acp_cancelled',
    });
  }, 15_000);

  it('rejects a second run when the global concurrency limit is reached', async () => {
    const first = backend('slow', { limits: { maxConcurrentRuns: 1 } }).execute('one', {});
    try {
      expect(getActiveAcpRunCount()).toBe(1);
      const second = backend('normal', { limits: { maxConcurrentRuns: 1 } }).execute('two', {});
      await expect(second.result).resolves.toMatchObject({
        status: 'failed',
        reasonCode: 'acp_concurrency_limit',
      });
    } finally {
      first.kill();
      await drain(first);
    }
    await waitForNoActiveRuns();
    expect(getActiveAcpRunCount()).toBe(0);
  });

  it('truncates one oversized ACP event without losing the completed turn', async () => {
    const run = backend('large', {
      limits: { maxEventChars: 128, maxOutputChars: 1_000 },
    }).execute('hello', {});
    const { events, result } = await drain(run);
    expect(result).toMatchObject({ status: 'completed' });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        content: `${'x'.repeat(128)}\n[truncated]`,
      }),
    ]));
  }, 15_000);

  it('fails when cumulative streamed output exceeds the turn budget', async () => {
    const run = backend('large', {
      limits: { maxEventChars: 20_000, maxOutputChars: 128 },
    }).execute('hello', {});
    const { result } = await drain(run);
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'acp_output_limit' });
  }, 15_000);

  it('fails when a slow consumer lets the event queue exceed its bound', async () => {
    const run = backend('flood', {
      limits: { maxQueuedEvents: 2 },
    }).execute('hello', {});
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const { result } = await drain(run);
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'acp_event_limit' });
  }, 15_000);

  it('never exposes raw bearer credentials from stderr', async () => {
    const run = backend('error').execute('hello', {});
    const { events, result } = await drain(run);
    const diagnostic = `${result.error ?? ''}\n${events.map((event) => event.content).join('\n')}`;
    expect(diagnostic).not.toContain('test-secret-token');
  }, 15_000);
});
