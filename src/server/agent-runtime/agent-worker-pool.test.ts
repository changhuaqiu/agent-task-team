import { describe, expect, it } from 'vitest';
import { AgentWorkerPool } from './agent-worker-pool';

describe('AgentWorkerPool', () => {
  it('keeps session-lane affinity while allowing another lane to use partial capacity', () => {
    const pool = new AgentWorkerPool<{ process: string }>();
    pool.add({ id: 'worker-1', worker: { process: 'one' } });
    pool.add({ id: 'worker-2', worker: { process: 'two' } });

    const first = pool.claim('conversation-a')!;
    const parallel = pool.claim('conversation-b')!;
    expect(first.id).toBe('worker-1');
    expect(parallel.id).toBe('worker-2');
    expect(pool.capacity()).toEqual({ readyWorkers: 0, totalWorkers: 2 });

    pool.release(first, 'success');
    pool.release(parallel, 'application_failure');
    expect(pool.claim('conversation-a')?.id).toBe('worker-1');
  });

  it('keeps workers for application failures and replaces them for transport failures', () => {
    const pool = new AgentWorkerPool<{ process: string }>();
    pool.add({ id: 'worker-1', worker: { process: 'one' } });

    const application = pool.claim('conversation-a')!;
    expect(pool.release(application, 'application_failure')).toEqual({ replaceWorker: false });
    const transport = pool.claim('conversation-a')!;
    expect(pool.release(transport, 'transport_failure')).toEqual({
      replaceWorker: true,
      worker: { process: 'one' },
    });
    expect(pool.capacity()).toEqual({ readyWorkers: 0, totalWorkers: 0 });
    expect(pool.affinityOwner('conversation-a')).toBeUndefined();
  });

  it('serializes one affine lane even when another worker is idle', () => {
    const pool = new AgentWorkerPool<{ process: string }>();
    pool.add({ id: 'worker-1', worker: { process: 'one' } });
    pool.add({ id: 'worker-2', worker: { process: 'two' } });

    const first = pool.claim('conversation-a')!;
    expect(first.id).toBe('worker-1');
    expect(pool.claim('conversation-a')).toBeUndefined();
    expect(pool.claim('conversation-b')?.id).toBe('worker-2');
  });

  it('fences stale releases after a worker receives a newer lease', () => {
    const pool = new AgentWorkerPool<{ process: string }>();
    pool.add({ id: 'worker-1', worker: { process: 'one' } });
    const stale = pool.claim('conversation-a')!;
    pool.release(stale, 'success');
    const current = pool.claim('conversation-a')!;

    expect(pool.release(stale, 'transport_failure')).toEqual({ replaceWorker: false });
    expect(pool.capacity()).toEqual({ readyWorkers: 0, totalWorkers: 1 });
    expect(pool.release(current, 'success')).toEqual({ replaceWorker: false });
  });
});
