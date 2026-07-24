import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { DeliveryAdvancementRequestQueue } from './advancement-queue';

describe('DeliveryAdvancementRequestQueue', () => {
  let db: Database.Database;
  let now: Date;
  let queue: DeliveryAdvancementRequestQueue;
  let sourceEventId: string;

  beforeEach(() => {
    db = createTestDb();
    now = new Date('2026-07-25T06:00:00.000Z');
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    sourceEventId = new PlatformEventLog({ db }).append({
      type: 'task.done',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'task-1',
      payload: {},
    }).eventId;
    queue = new DeliveryAdvancementRequestQueue({ db, now: () => now });
  });

  afterEach(() => db.close());

  it('admits idempotently and records execution success only after advance resolves', async () => {
    const input = {
      sourceEventId,
      projectId: 'project-1',
      cause: { kind: 'fact_changed' as const, ref: 'task-1' },
    };
    queue.enqueue(input);
    queue.enqueue(input);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const advance = vi.fn(() => pending);
    const running = queue.runNext(advance);

    expect(db.prepare(
      `SELECT status FROM autonomous_delivery_advancement_request`,
    ).get()).toEqual({ status: 'running' });
    release();
    await running;

    expect(advance).toHaveBeenCalledWith('project-1', input.cause);
    expect(db.prepare(
      `SELECT status,attempt_count,last_error FROM autonomous_delivery_advancement_request`,
    ).get()).toEqual({ status: 'completed', attempt_count: 1, last_error: null });
  });

  it('requeues interface failures and recovers interrupted requests', async () => {
    queue.enqueue({
      sourceEventId,
      projectId: 'project-1',
      cause: { kind: 'fact_changed', ref: 'task-1' },
    });
    await queue.runNext(async () => { throw new Error('temporary'); });
    expect(db.prepare(
      `SELECT status,attempt_count,last_error FROM autonomous_delivery_advancement_request`,
    ).get()).toEqual({
      status: 'queued',
      attempt_count: 1,
      last_error: 'temporary',
    });

    db.prepare(`
      UPDATE autonomous_delivery_advancement_request SET status='running'
    `).run();
    now = new Date('2026-07-25T06:00:02.000Z');
    expect(queue.recover()).toBe(1);
    expect(db.prepare(
      `SELECT status,available_at FROM autonomous_delivery_advancement_request`,
    ).get()).toEqual({ status: 'queued', available_at: now.toISOString() });
  });
});
