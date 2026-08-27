import { describe, expect, it, vi } from 'vitest';
import {
  ManagedAgentRuntimeSupervisor,
  type ManagedAgentRuntimeKey,
  type ManagedRuntimeHandle,
} from './managed-runtime-supervisor';

const KEY: ManagedAgentRuntimeKey = {
  agentId: 'builder',
  projectId: 'project-1',
  runtimeNodeId: 'node-local',
  runtimeId: 'codex-acp',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function handle(readyWorkers = 1, totalWorkers = 1, subscriptionsReady = true) {
  const stop = vi.fn();
  return {
    value: {
      capacity: () => ({ readyWorkers, totalWorkers }),
      subscriptionsReady: () => subscriptionsReady,
      stop,
    } satisfies ManagedRuntimeHandle,
    stop,
  };
}

describe('ManagedAgentRuntimeSupervisor', () => {
  it('singleflights concurrent startup and exposes partial readiness', async () => {
    const start = deferred<ManagedRuntimeHandle>();
    const starter = { start: vi.fn(() => start.promise) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });

    const first = supervisor.ensureReady(KEY);
    const second = supervisor.ensureReady(KEY);
    expect(starter.start).toHaveBeenCalledTimes(1);
    expect(supervisor.get(KEY)).toMatchObject({ lifecycle: 'starting', acceptingWork: false });

    start.resolve(handle(1, 2).value);
    await expect(first).resolves.toMatchObject({
      lifecycle: 'degraded',
      acceptingWork: true,
      readyWorkers: 1,
      totalWorkers: 2,
    });
    await expect(second).resolves.toMatchObject({ lifecycle: 'degraded' });
  });

  it('stops a stale generation result instead of replacing the current runtime', async () => {
    const oldStart = deferred<ManagedRuntimeHandle>();
    const newStart = deferred<ManagedRuntimeHandle>();
    const oldHandle = handle();
    const newHandle = handle();
    const starter = { start: vi.fn()
      .mockImplementationOnce(() => oldStart.promise)
      .mockImplementationOnce(() => newStart.promise) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });

    void supervisor.ensureReady(KEY);
    const reconfigured = supervisor.reconfigure(KEY);
    newStart.resolve(newHandle.value);
    await expect(reconfigured).resolves.toMatchObject({ generation: 2, lifecycle: 'ready' });

    oldStart.resolve(oldHandle.value);
    await Promise.resolve();
    await Promise.resolve();
    expect(oldHandle.stop).toHaveBeenCalledTimes(1);
    expect(supervisor.get(KEY)).toMatchObject({ generation: 2, lifecycle: 'ready' });
    expect(newHandle.stop).not.toHaveBeenCalled();
  });

  it('backs off repeated failures and opens a bounded circuit', async () => {
    let now = Date.parse('2026-08-23T12:00:00.000Z');
    const starter = { start: vi.fn(async () => { throw new Error('adapter crashed'); }) };
    const supervisor = new ManagedAgentRuntimeSupervisor({
      starter,
      now: () => now,
      retryBaseMs: 10,
      retryMaxMs: 40,
      circuitFailureThreshold: 3,
      circuitWindowMs: 1_000,
      circuitOpenMs: 100,
    });

    await expect(supervisor.ensureReady(KEY)).resolves.toMatchObject({
      lifecycle: 'failed',
      failureCount: 1,
    });
    expect((await supervisor.ensureReady(KEY)).reasonCode).toBe('runtime_backoff');
    now += 10;
    await supervisor.ensureReady(KEY);
    now += 20;
    const third = await supervisor.ensureReady(KEY);
    expect(third).toMatchObject({ lifecycle: 'failed', failureCount: 3 });
    expect(third.reasonCode).toContain('runtime_circuit_open');
    expect(third.circuitOpenUntil).toBeDefined();
    expect(starter.start).toHaveBeenCalledTimes(3);

    now += 100;
    await supervisor.ensureReady(KEY);
    expect(starter.start).toHaveBeenCalledTimes(4);
  });

  it('does not accept work before required subscriptions are ready', async () => {
    const starter = { start: vi.fn(async () => handle(1, 1, false).value) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });

    await expect(supervisor.ensureReady(KEY)).resolves.toMatchObject({
      lifecycle: 'listening',
      acceptingWork: false,
      readyWorkers: 1,
    });
  });

  it('reconfigures one logical runtime owner instead of creating a second owner', async () => {
    const first = handle();
    const second = handle();
    const starter = { start: vi.fn()
      .mockResolvedValueOnce(first.value)
      .mockResolvedValueOnce(second.value) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });
    await supervisor.ensureReady(KEY);

    const changed = await supervisor.ensureReady({ ...KEY, runtimeId: 'claude-agent-acp' });
    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(changed).toMatchObject({
      generation: 2,
      lifecycle: 'ready',
      key: { runtimeId: 'claude-agent-acp' },
    });
    expect(starter.start).toHaveBeenCalledTimes(2);
  });

  it('serializes overlapping runtime changes and leaves the latest request ready', async () => {
    const initialStop = deferred<void>();
    const initial = handle();
    initial.value.stop = vi.fn(() => initialStop.promise);
    const intermediate = handle();
    const latest = handle();
    const starter = { start: vi.fn()
      .mockResolvedValueOnce(initial.value)
      .mockResolvedValueOnce(intermediate.value)
      .mockResolvedValueOnce(latest.value) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });
    await supervisor.ensureReady(KEY);

    const first = supervisor.ensureReady({ ...KEY, runtimeId: 'claude-agent-acp' });
    const second = supervisor.ensureReady({ ...KEY, runtimeId: 'opencode-acp' });
    initialStop.resolve();

    await expect(first).resolves.toMatchObject({
      lifecycle: 'ready',
      key: { runtimeId: 'claude-agent-acp' },
    });
    await expect(second).resolves.toMatchObject({
      generation: 3,
      lifecycle: 'ready',
      acceptingWork: true,
      key: { runtimeId: 'opencode-acp' },
    });
    expect(supervisor.get(KEY)).toMatchObject({
      generation: 3,
      lifecycle: 'ready',
      key: { runtimeId: 'opencode-acp' },
    });
    expect(starter.start).toHaveBeenCalledTimes(3);
    expect(intermediate.stop).toHaveBeenCalledTimes(1);
    expect(latest.stop).not.toHaveBeenCalled();
  });

  it('serializes stop behind an in-flight reconfigure so stopped remains authoritative', async () => {
    const initialStop = deferred<void>();
    const initial = handle();
    initial.value.stop = vi.fn(() => initialStop.promise);
    const replacement = handle();
    const starter = { start: vi.fn()
      .mockResolvedValueOnce(initial.value)
      .mockResolvedValueOnce(replacement.value) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });
    await supervisor.ensureReady(KEY);

    const reconfigured = supervisor.reconfigure({ ...KEY, runtimeId: 'claude-agent-acp' });
    const stopped = supervisor.stop(KEY);
    initialStop.resolve();

    await expect(reconfigured).resolves.toMatchObject({ lifecycle: 'ready', generation: 2 });
    await expect(stopped).resolves.toMatchObject({ lifecycle: 'stopped', generation: 3, acceptingWork: false });
    expect(supervisor.get(KEY)).toMatchObject({ lifecycle: 'stopped', generation: 3, acceptingWork: false });
    expect(replacement.stop).toHaveBeenCalledTimes(1);
  });

  it('serializes shutdown behind an in-flight reconfigure and never starts again', async () => {
    const initialStop = deferred<void>();
    const initial = handle();
    initial.value.stop = vi.fn(() => initialStop.promise);
    const replacement = handle();
    const starter = { start: vi.fn()
      .mockResolvedValueOnce(initial.value)
      .mockResolvedValueOnce(replacement.value) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });
    await supervisor.ensureReady(KEY);

    const reconfigured = supervisor.reconfigure({ ...KEY, runtimeId: 'claude-agent-acp' });
    const shutdown = supervisor.shutdown();
    initialStop.resolve();

    await expect(reconfigured).resolves.toMatchObject({ lifecycle: 'stopped', acceptingWork: false });
    await shutdown;
    expect(supervisor.get(KEY)).toMatchObject({ lifecycle: 'stopped', acceptingWork: false });
    await expect(supervisor.ensureReady(KEY)).resolves.toMatchObject({ lifecycle: 'stopped', acceptingWork: false });
    expect(starter.start).toHaveBeenCalledTimes(1);
  });

  it('never includes raw adapter errors in public snapshots', async () => {
    const starter = { start: vi.fn(async () => {
      throw new Error('authorization=Bearer secret-value');
    }) };
    const supervisor = new ManagedAgentRuntimeSupervisor({ starter });
    const snapshot = await supervisor.ensureReady(KEY);
    expect(snapshot.reasonCode).toBe('runtime_start_failed');
    expect(JSON.stringify(snapshot)).not.toContain('secret-value');
  });
});
