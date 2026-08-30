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
    expect(calls).toEqual({ register: 21, recover: 1, discover: 1, drain: 1 });

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
      id: 'task-wakeup-router:v2',
      pattern: 'task.*',
    }), expect.objectContaining({
      id: 'a2a-outcome-process-manager:v3',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'gate-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-graph-outcome-process-manager:v2',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-graph-scheduler-process-manager:v1',
      pattern: 'task.done',
    }), expect.objectContaining({
      id: 'task-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
    }), expect.objectContaining({
      id: 'task-gate-lifecycle-process-manager:v1',
      pattern: 'gate.*',
    }), expect.objectContaining({
      id: 'control-slot-release-process-manager:context:v1',
      pattern: 'context.snapshot.rejected',
    }), expect.objectContaining({
      id: 'control-slot-release-process-manager:inbox:v1',
      pattern: 'agent.work.*',
    }), expect.objectContaining({
      id: 'control-slot-release-process-manager:work:v1',
      pattern: 'work.authority.closed',
    }), expect.objectContaining({
      id: 'work-lifecycle-reconciler:task:v1',
      pattern: 'task.*',
    }), expect.objectContaining({
      id: 'work-lifecycle-reconciler:delivery:v1',
      pattern: 'delivery.run.*',
    }), expect.objectContaining({
      id: 'work-lifecycle-reconciler:late-inbox:v1',
      pattern: 'agent.work.enqueued',
    }), expect.objectContaining({
      id: 'evaluation-work-lifecycle-process-manager:v1',
      pattern: 'agent.work.*',
    })]));
    expect(registrations).toHaveLength(22);
  });

  it('registers Phoenix projection only when the collector is explicitly configured', () => {
    const previousEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT;
    const previousProject = process.env.ATH_PHOENIX_PROJECT_NAME;
    const registrations: Array<{ id: string; pattern: string }> = [];
    const dispatcher = {
      register(registration: { id: string; pattern: string }) { registrations.push(registration); },
      recover() { return { enqueued: 0, abandonedAttempts: 0 }; },
      discover() { return 0; },
      async drain() { return { succeeded: 0, failed: 0, deadLettered: 0 }; },
    };
    try {
      delete process.env.PHOENIX_COLLECTOR_ENDPOINT;
      new PlatformEventRuntimeWorker({ dispatcher });
      expect(registrations.some((registration) => registration.id.startsWith('phoenix-trace-export:')))
        .toBe(false);

      registrations.length = 0;
      process.env.PHOENIX_COLLECTOR_ENDPOINT = 'http://127.0.0.1:6006';
      process.env.ATH_PHOENIX_PROJECT_NAME = 'agent-task-team';
      new PlatformEventRuntimeWorker({
        dispatcher,
        phoenixDispatcher: dispatcher,
        phoenix: { sink: { export: vi.fn(async () => undefined) } },
      });
      expect(registrations).toEqual(expect.arrayContaining([expect.objectContaining({
        id: 'phoenix-trace-export:v2',
        pattern: 'runtime.invocation.terminated',
      })]));
    } finally {
      if (previousEndpoint === undefined) delete process.env.PHOENIX_COLLECTOR_ENDPOINT;
      else process.env.PHOENIX_COLLECTOR_ENDPOINT = previousEndpoint;
      if (previousProject === undefined) delete process.env.ATH_PHOENIX_PROJECT_NAME;
      else process.env.ATH_PHOENIX_PROJECT_NAME = previousProject;
    }
  });

  it('keeps the main process-manager loop live while Phoenix export is blocked', async () => {
    vi.useFakeTimers();
    const previousEndpoint = process.env.PHOENIX_COLLECTOR_ENDPOINT;
    process.env.PHOENIX_COLLECTOR_ENDPOINT = 'http://127.0.0.1:1';
    let releasePhoenix!: () => void;
    const blockedPhoenix = new Promise<void>((resolve) => { releasePhoenix = resolve; });
    const main = {
      register: vi.fn(),
      recover: vi.fn(() => ({ enqueued: 0, abandonedAttempts: 0 })),
      discover: vi.fn(() => 0),
      drain: vi.fn(async () => ({ succeeded: 0, failed: 0, deadLettered: 0 })),
    };
    const phoenix = {
      register: vi.fn(),
      recover: vi.fn(() => ({ enqueued: 0, abandonedAttempts: 0 })),
      discover: vi.fn(() => 0),
      drain: vi.fn(async () => {
        await blockedPhoenix;
        return { succeeded: 0, failed: 0, deadLettered: 0 };
      }),
    };
    const worker = new PlatformEventRuntimeWorker({
      intervalMs: 10,
      dispatcher: main,
      phoenixDispatcher: phoenix,
      phoenix: { sink: { export: vi.fn(async () => undefined) } },
    });
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(30);
      expect(main.drain.mock.calls.length).toBeGreaterThanOrEqual(3);
      expect(phoenix.drain).toHaveBeenCalledTimes(1);
    } finally {
      worker.stop();
      releasePhoenix();
      if (previousEndpoint === undefined) delete process.env.PHOENIX_COLLECTOR_ENDPOINT;
      else process.env.PHOENIX_COLLECTOR_ENDPOINT = previousEndpoint;
    }
  });

  it('wires Effect and terminal Control facts back into Delivery reconciliation', () => {
    const registrations: Array<{ id: string; pattern: string }> = [];
    const dispatcher = {
      register(registration: { id: string; pattern: string }) {
        registrations.push(registration);
      },
      recover() { return { enqueued: 0, abandonedAttempts: 0 }; },
      discover() { return 0; },
      async drain() { return { succeeded: 0, failed: 0, deadLettered: 0 }; },
    };
    new PlatformEventRuntimeWorker({
      dispatcher,
      deliveryAdvancement: { advanceProject: vi.fn() },
    });

    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'delivery-process-manager-effect:v1',
        pattern: 'effect.*',
      }),
      expect.objectContaining({
        id: 'delivery-process-manager-control:v1',
        pattern: 'control.action.failed',
      }),
    ]));
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
