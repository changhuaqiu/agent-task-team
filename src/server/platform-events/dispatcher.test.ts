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
    expect(await dispatcher.drain()).toEqual({ succeeded: 2, failed: 0, deadLettered: 0 });
    expect(handled).toEqual(['task:1:1', 'task:1:2']);

    const deliveries = db.prepare(`
      SELECT status, attempt_count FROM platform_event_delivery ORDER BY stream_sequence
    `).all();
    expect(deliveries).toEqual([
      { status: 'succeeded', attempt_count: 1 },
      { status: 'succeeded', attempt_count: 1 },
    ]);
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
    expect(await dispatcher.drain()).toEqual({ succeeded: 2, failed: 0, deadLettered: 0 });
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
});
