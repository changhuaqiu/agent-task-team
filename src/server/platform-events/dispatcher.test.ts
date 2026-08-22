import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventDispatcher } from './dispatcher';
import { PlatformEventLog } from './event-log';

describe('PlatformEventDispatcher', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let now: Date;
  let id = 0;

  beforeEach(() => {
    db = createTestDb();
    now = new Date('2026-07-24T00:00:00.000Z');
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    log = new PlatformEventLog({
      db,
      now: () => now,
      idFactory: () => `pev-${++id}`,
    });
  });

  afterEach(() => {
    db.close();
  });

  function append(type: string, streamKey: string) {
    return log.append({
      type,
      category: 'domain',
      projectId: 'project-1',
      streamKey,
      aggregate: { type: 'task', id: streamKey },
      actor: { type: 'system', id: 'test' },
      correlationId: 'test-correlation',
      payload: { type },
    });
  }

  function createDispatcher() {
    return new PlatformEventDispatcher({
      db,
      eventLog: log,
      workerId: 'worker-1',
      now: () => now,
      idFactory: (prefix) => `${prefix}-${++id}`,
      retryDelayMs: () => 1_000,
      leaseMs: 5_000,
    });
  }

  it('recovers committed events and drains each handler stream in order', async () => {
    append('task.assigned', 'task:1');
    append('task.in_progress', 'task:1');
    const handled: string[] = [];
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'task-projection',
      pattern: 'task.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: (event) => handled.push(`${event.streamKey}:${event.streamSequence}`),
    });

    expect(dispatcher.recover()).toEqual({ enqueued: 2, abandonedAttempts: 0 });
    expect(dispatcher.recover()).toEqual({ enqueued: 0, abandonedAttempts: 0 });
    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });
    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });
    expect(handled).toEqual(['task:1:1', 'task:1:2']);

    const deliveries = db.prepare(`
      SELECT status, attempt_count FROM platform_event_delivery ORDER BY stream_sequence
    `).all();
    expect(deliveries).toEqual([
      { status: 'succeeded', attempt_count: 1 },
      { status: 'succeeded', attempt_count: 1 },
    ]);
  });

  it('discovers only events beyond the persisted handler cursor', () => {
    append('task.assigned', 'task:1');
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'incremental-router',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      handle: () => undefined,
    });
    expect(dispatcher.recover().enqueued).toBe(1);
    expect(dispatcher.discover()).toBe(0);
    append('runtime.warning.raised', 'invocation:1');
    append('task.assigned', 'task:2');
    expect(dispatcher.discover()).toBe(1);
    expect(dispatcher.discover()).toBe(0);
    expect(db.prepare(`
      SELECT last_ingestion_id FROM platform_event_handler_cursor WHERE handler_id='incremental-router'
    `).get()).toEqual({ last_ingestion_id: 3 });

    const latest = db.prepare(`
      SELECT event_id FROM platform_event_ingestion ORDER BY ingestion_id DESC LIMIT 1
    `).get() as { event_id: string };
    db.prepare('DELETE FROM platform_event WHERE id=?').run(latest.event_id);
    append('task.assigned', 'task:3');
    expect(dispatcher.discover()).toBe(1);
    expect(db.prepare(`
      SELECT last_ingestion_id FROM platform_event_handler_cursor WHERE handler_id='incremental-router'
    `).get()).toEqual({ last_ingestion_id: 4 });
  });

  it('isolates a failed stream, retries it, and continues another stream', async () => {
    append('task.assigned', 'task:1');
    append('task.in_progress', 'task:1');
    append('task.assigned', 'task:2');
    const handled: string[] = [];
    let failFirst = true;
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'task-router',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      handle: (event) => {
        handled.push(`${event.streamKey}:${event.streamSequence}`);
        if (event.streamKey === 'task:1' && failFirst) {
          failFirst = false;
          throw new Error('temporary');
        }
      },
    });
    dispatcher.recover();

    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 1, deadLettered: 0 });
    expect(new Set(handled)).toEqual(new Set(['task:1:1', 'task:2:1']));

    now = new Date(now.getTime() + 1_000);
    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });
    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });
    expect(handled.slice(2)).toEqual(['task:1:1', 'task:1:2']);
  });

  it('abandons an expired attempt and resumes it after restart', async () => {
    append('task.assigned', 'task:1');
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'task-pm',
      pattern: 'task.assigned',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: () => undefined,
    });
    dispatcher.recover();

    const delivery = db.prepare('SELECT id FROM platform_event_delivery').get() as { id: string };
    db.prepare(`
      UPDATE platform_event_delivery
      SET status='running', attempt_count=1, lease_owner='dead-worker',
          lease_expires_at=?, updated_at=?
      WHERE id=?
    `).run(
      new Date(now.getTime() - 1_000).toISOString(),
      now.toISOString(),
      delivery.id,
    );
    db.prepare(`
      INSERT INTO platform_event_delivery_attempt (
        id,delivery_id,attempt_no,worker_id,status,started_at
      ) VALUES ('attempt-dead',?,1,'dead-worker','running',?)
    `).run(delivery.id, new Date(now.getTime() - 2_000).toISOString());

    expect(dispatcher.recover()).toEqual({ enqueued: 0, abandonedAttempts: 1 });
    expect(await dispatcher.drain()).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });
    expect(db.prepare(`
      SELECT status FROM platform_event_delivery_attempt ORDER BY attempt_no
    `).all()).toEqual([{ status: 'abandoned' }, { status: 'succeeded' }]);
  });

  it('does not recover expired deliveries owned by another dispatcher registry', () => {
    append('runtime.invocation.terminated', 'invocation:1');
    const main = createDispatcher();
    main.register({
      id: 'main-task-handler',
      pattern: 'task.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: () => undefined,
    });
    const phoenix = createDispatcher();
    phoenix.register({
      id: 'phoenix-export-handler',
      pattern: 'runtime.invocation.terminated',
      stereotype: 'projection',
      reliability: 'durable',
      maxAttempts: 12,
      handle: () => undefined,
    });
    phoenix.recover();
    db.prepare(`
      UPDATE platform_event_delivery
      SET status='running',attempt_count=8,lease_owner='phoenix-dead',
          lease_expires_at=?,updated_at=?
      WHERE handler_id='phoenix-export-handler'
    `).run(new Date(now.getTime() - 1_000).toISOString(), now.toISOString());

    expect(main.recover()).toEqual({ enqueued: 0, abandonedAttempts: 0 });
    expect(db.prepare(`
      SELECT status,attempt_count,lease_owner
      FROM platform_event_delivery WHERE handler_id='phoenix-export-handler'
    `).get()).toEqual({ status: 'running', attempt_count: 8, lease_owner: 'phoenix-dead' });
  });

  it('isolates best-effort failures without creating durable delivery rows', async () => {
    const event = append('runtime.warning.raised', 'invocation:1');
    const handled: string[] = [];
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'socket-projection',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'best_effort',
      handle: () => {
        throw new Error('socket unavailable');
      },
    });
    dispatcher.register({
      id: 'metrics-projection',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'best_effort',
      handle: (received) => handled.push(received.eventId),
    });

    const failures = await dispatcher.dispatchBestEffort(event);
    expect(failures.map((failure) => failure.handlerId)).toEqual(['socket-projection']);
    expect(handled).toEqual([event.eventId]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM platform_event_delivery').get())
      .toEqual({ count: 0 });
  });

  it('times out a hung handler so unrelated best-effort handlers still settle', async () => {
    const event = append('runtime.warning.raised', 'invocation:1');
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'hung',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'best_effort',
      timeoutMs: 5,
      handle: () => new Promise(() => undefined),
    });
    dispatcher.register({
      id: 'healthy',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'best_effort',
      handle: () => undefined,
    });

    const failures = await dispatcher.dispatchBestEffort(event);
    expect(failures.map((failure) => failure.handlerId)).toEqual(['hung']);
  });

  it('fences a stale completion after the delivery is recovered and reclaimed', async () => {
    append('task.assigned', 'task:1');
    let releaseOld!: () => void;
    const oldHandler = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const first = createDispatcher();
    first.register({
      id: 'task-router',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      timeoutMs: 100,
      handle: () => oldHandler,
    });
    first.recover();
    const oldDrain = first.drain(1);
    await new Promise((resolve) => setTimeout(resolve, 0));

    now = new Date(now.getTime() + 6_000);
    const replacement = createDispatcher();
    replacement.register({
      id: 'task-router',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      handle: () => undefined,
    });
    expect(replacement.recover().abandonedAttempts).toBe(1);
    expect(await replacement.drain(1)).toEqual({ succeeded: 1, failed: 0, deadLettered: 0 });

    releaseOld();
    expect(await oldDrain).toEqual({ succeeded: 0, failed: 0, deadLettered: 0 });
    expect(db.prepare(`
      SELECT status, attempt_count FROM platform_event_delivery
    `).get()).toEqual({ status: 'succeeded', attempt_count: 2 });
  });

  it('dead-letters an expired claim that exhausted its attempt budget', () => {
    append('task.assigned', 'task:1');
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'task-pm',
      pattern: 'task.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      maxAttempts: 1,
      handle: () => undefined,
    });
    dispatcher.recover();
    db.prepare(`
      UPDATE platform_event_delivery
      SET status='running', attempt_count=1, lease_owner='dead-worker',
          lease_expires_at=?, current_attempt_id='attempt-dead'
    `).run(new Date(now.getTime() - 1_000).toISOString());
    db.prepare(`
      INSERT INTO platform_event_delivery_attempt (
        id,delivery_id,attempt_no,worker_id,status,started_at
      ) SELECT 'attempt-dead',id,1,'dead-worker','running',? FROM platform_event_delivery
    `).run(new Date(now.getTime() - 2_000).toISOString());

    expect(dispatcher.recover()).toEqual({ enqueued: 0, abandonedAttempts: 1 });
    expect(db.prepare(`
      SELECT status, completed_at FROM platform_event_delivery
    `).get()).toEqual({ status: 'dead_letter', completed_at: now.toISOString() });
  });

  it('cooperatively aborts a timed-out durable handler before retrying its stream', async () => {
    append('task.assigned', 'task:1');
    let active = 0;
    let maxActive = 0;
    const dispatcher = createDispatcher();
    dispatcher.register({
      id: 'abortable-router',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      timeoutMs: 5,
      maxAttempts: 2,
      handle: (_event, { signal }) => new Promise<void>((resolve) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        signal.addEventListener('abort', () => {
          active -= 1;
          resolve();
        }, { once: true });
      }),
    });
    dispatcher.recover();

    expect(await dispatcher.drain(1)).toEqual({ succeeded: 0, failed: 1, deadLettered: 0 });
    now = new Date(now.getTime() + 1_000);
    expect(await dispatcher.drain(1)).toEqual({ succeeded: 0, failed: 1, deadLettered: 1 });
    expect(maxActive).toBe(1);
    expect(active).toBe(0);
  });
});
