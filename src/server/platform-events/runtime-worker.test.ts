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
    expect(calls).toEqual({ register: 1, recover: 1, discover: 1, drain: 1 });

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
});
