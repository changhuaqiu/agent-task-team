import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformEventRuntimeWorker } from './runtime-worker';

describe('PlatformEventRuntimeWorker', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs one self-scheduled polling cycle at a time and supports stop/restart', async () => {
    vi.useFakeTimers();
    let releaseDrain!: () => void;
    let drainPromise = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const calls = { register: 0, recover: 0, discover: 0, drain: 0 };
    const dispatcher = {
      register() { calls.register += 1; },
      recover() {
        calls.recover += 1;
        return { enqueued: 0, abandonedAttempts: 0 };
      },
      discover() {
        calls.discover += 1;
        return 0;
      },
      async drain() {
        calls.drain += 1;
        await drainPromise;
        return { succeeded: 0, failed: 0, deadLettered: 0 };
      },
    };
    const worker = new PlatformEventRuntimeWorker({
      intervalMs: 10,
      dispatcher,
    });

    worker.start();
    worker.start();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toEqual({ register: 14, recover: 1, discover: 1, drain: 1 });

    releaseDrain();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls.discover).toBe(2);
    expect(calls.drain).toBe(2);

    worker.stop();
    drainPromise = Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls.drain).toBe(2);

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.recover).toBe(2);
    expect(calls.drain).toBe(3);
    worker.stop();
  });

  it('registers the durable Runtime completion process manager when an effect outbox is supplied', () => {
    const registrations: Array<{ id: string; pattern: string }> = [];
    const dispatcher = {
      register(registration: { id: string; pattern: string }) {
        registrations.push(registration);
      },
      recover() { return { enqueued: 0, abandonedAttempts: 0 }; },
      discover() { return 0; },
      async drain() { return { succeeded: 0, failed: 0, deadLettered: 0 }; },
    };

    const effects = {
      enqueueBatch: vi.fn(() => []),
      recover: vi.fn(() => ({ recovered: 0, abandonedAttempts: 0, deadLettered: 0 })),
      drain: vi.fn(async () => ({
        succeeded: 0,
        failed: 0,
        deadLettered: 0,
        fenced: 0,
      })),
    };
    new PlatformEventRuntimeWorker({
      dispatcher,
      effectOutbox: effects,
    });

    expect(registrations).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'runtime-completion-process-manager:v1',
      pattern: 'runtime.invocation.terminated',
    }), expect.objectContaining({
      id: 'gate-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-graph-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-gate-lifecycle-process-manager:v1',
      pattern: 'gate.*',
    }), expect.objectContaining({
      id: 'control-slot-release-process-manager:context:v1',
      pattern: 'context.snapshot.rejected',
    })]));
    expect(registrations).toHaveLength(15);
  });

  it('retries startup recovery before incremental discovery', async () => {
    vi.useFakeTimers();
    let recoverCalls = 0;
    const dispatcher = {
      register() {},
      recover() {
        recoverCalls += 1;
        if (recoverCalls === 1) throw new Error('temporary');
        return { enqueued: 0, abandonedAttempts: 0 };
      },
      discover: vi.fn(() => 0),
      drain: vi.fn(async () => ({ succeeded: 0, failed: 0, deadLettered: 0 })),
    };
    const worker = new PlatformEventRuntimeWorker({ intervalMs: 10, dispatcher });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(dispatcher.discover).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(recoverCalls).toBe(2);
    expect(dispatcher.discover).toHaveBeenCalledTimes(1);
    worker.stop();
  });

  it('recovers and drains durable effects after event dispatch', async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const dispatcher = {
      register() {},
      recover() {
        order.push('event-recover');
        return { enqueued: 0, abandonedAttempts: 0 };
      },
      discover() {
        order.push('event-discover');
        return 0;
      },
      async drain() {
        order.push('event-drain');
        return { succeeded: 0, failed: 0, deadLettered: 0 };
      },
    };
    const effects = {
      enqueueBatch: vi.fn(() => []),
      recover() {
        order.push('effect-recover');
        return { recovered: 0, abandonedAttempts: 0, deadLettered: 0 };
      },
      async drain() {
        order.push('effect-drain');
        return { succeeded: 0, failed: 0, deadLettered: 0, fenced: 0 };
      },
    };
    const worker = new PlatformEventRuntimeWorker({
      intervalMs: 10,
      dispatcher,
      effectOutbox: effects,
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();

    expect(order).toEqual([
      'event-recover',
      'effect-recover',
      'event-discover',
      'event-drain',
      'effect-drain',
    ]);
  });

  it('fences an old in-flight tick across stop and restart', async () => {
    vi.useFakeTimers();
    let releaseOld!: () => void;
    const oldDrain = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    let drainCalls = 0;
    const dispatcher = {
      register() {},
      recover: vi.fn(() => ({ enqueued: 0, abandonedAttempts: 0 })),
      discover: vi.fn(() => 0),
      async drain() {
        drainCalls += 1;
        if (drainCalls === 1) await oldDrain;
        return { succeeded: 0, failed: 0, deadLettered: 0 };
      },
    };
    const worker = new PlatformEventRuntimeWorker({ intervalMs: 10, dispatcher });
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    worker.stop();
    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(drainCalls).toBe(2);

    releaseOld();
    await vi.advanceTimersByTimeAsync(10);
    expect(drainCalls).toBe(3);
    await vi.advanceTimersByTimeAsync(10);
    expect(drainCalls).toBe(4);
    worker.stop();
  });
});
