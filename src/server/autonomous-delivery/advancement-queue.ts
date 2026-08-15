import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import type { AdvancementCause } from './types';

interface AdvancementRequestRow {
  id: string;
  source_event_id: string;
  project_id: string;
  cause_json: string;
  status: 'queued' | 'running' | 'completed';
  attempt_count: number;
}

interface DeliveryAdvancementRequestQueueOptions {
  db?: Database.Database;
  now?: () => Date;
}

export class DeliveryAdvancementRequestQueue {
  private readonly database?: Database.Database;
  private readonly now: () => Date;

  constructor(options: DeliveryAdvancementRequestQueueOptions = {}) {
    this.database = options.db;
    this.now = options.now ?? (() => new Date());
  }

  enqueue(input: {
    sourceEventId: string;
    projectId: string;
    cause: AdvancementCause;
  }): void {
    const db = this.database ?? getDb();
    const causeJson = JSON.stringify(input.cause);
    db.transaction(() => {
      const existing = db.prepare(`
        SELECT * FROM autonomous_delivery_advancement_request WHERE source_event_id=?
      `).get(input.sourceEventId) as AdvancementRequestRow | undefined;
      if (existing) {
        if (existing.project_id !== input.projectId || existing.cause_json !== causeJson) {
          throw new Error(`delivery_advancement_request_conflict:${input.sourceEventId}`);
        }
        return;
      }
      const now = this.now().toISOString();
      db.prepare(`
        INSERT INTO autonomous_delivery_advancement_request (
          id,source_event_id,project_id,cause_json,status,attempt_count,
          available_at,created_at,updated_at
        ) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)
      `).run(
        generateSortableId('delivery-advance'),
        input.sourceEventId,
        input.projectId,
        causeJson,
        now,
        now,
        now,
      );
    }).immediate();
  }

  recover(): number {
    const now = this.now().toISOString();
    return (this.database ?? getDb()).prepare(`
      UPDATE autonomous_delivery_advancement_request
      SET status='queued', available_at=?, updated_at=? WHERE status='running'
    `).run(now, now).changes;
  }

  async runNext(
    advance: (projectId: string, cause: AdvancementCause) => Promise<unknown> | undefined,
  ): Promise<boolean> {
    const db = this.database ?? getDb();
    const now = this.now();
    const row = db.transaction(() => {
      const candidate = db.prepare(`
        SELECT * FROM autonomous_delivery_advancement_request
        WHERE status='queued' AND available_at<=?
        ORDER BY available_at ASC, created_at ASC, id ASC LIMIT 1
      `).get(now.toISOString()) as AdvancementRequestRow | undefined;
      if (!candidate) return undefined;
      const claimed = db.prepare(`
        UPDATE autonomous_delivery_advancement_request
        SET status='running', attempt_count=attempt_count+1, updated_at=?
        WHERE id=? AND status='queued'
      `).run(now.toISOString(), candidate.id);
      return claimed.changes === 1
        ? { ...candidate, attempt_count: candidate.attempt_count + 1 }
        : undefined;
    }).immediate();
    if (!row) return false;

    try {
      await advance(row.project_id, JSON.parse(row.cause_json) as AdvancementCause);
      const completedAt = this.now().toISOString();
      db.prepare(`
        UPDATE autonomous_delivery_advancement_request
        SET status='completed', last_error=NULL, updated_at=?, completed_at=?
        WHERE id=? AND status='running'
      `).run(completedAt, completedAt, row.id);
    } catch (error) {
      const retryAt = new Date(
        this.now().getTime() + Math.min(30_000, 1_000 * (2 ** Math.max(0, row.attempt_count - 1))),
      ).toISOString();
      db.prepare(`
        UPDATE autonomous_delivery_advancement_request
        SET status='queued', available_at=?, last_error=?, updated_at=?
        WHERE id=? AND status='running'
      `).run(
        retryAt,
        error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
        this.now().toISOString(),
        row.id,
      );
    }
    return true;
  }
}

export const deliveryAdvancementQueue = new DeliveryAdvancementRequestQueue();
