import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import { PlatformEventLog } from './event-log';
import type { PlatformEvent } from './types';

export type PlatformEventHandlerStereotype =
  | 'router'
  | 'reducer'
  | 'process_manager'
  | 'projection';

export type PlatformEventHandlerReliability = 'durable' | 'best_effort';
export type PlatformEventHandler = (event: PlatformEvent) => void | Promise<void>;

export interface PlatformEventHandlerRegistration {
  id: string;
  pattern: string;
  stereotype: PlatformEventHandlerStereotype;
  reliability: PlatformEventHandlerReliability;
  handle: PlatformEventHandler;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface PlatformEventDispatcherOptions {
  db?: Database.Database;
  eventLog?: PlatformEventLog;
  workerId?: string;
  now?: () => Date;
  idFactory?: (prefix: 'ped' | 'pea') => string;
  leaseMs?: number;
  retryDelayMs?: (attemptNo: number) => number;
}

interface DeliveryRow {
  id: string;
  handler_id: string;
  event_id: string;
  attempt_count: number;
}

export interface DispatcherRecoveryResult {
  enqueued: number;
  abandonedAttempts: number;
}

export interface DispatcherDrainResult {
  succeeded: number;
  failed: number;
  deadLettered: number;
}

function matches(pattern: string, type: string): boolean {
  if (pattern.endsWith('*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}

export class PlatformEventDispatcher {
  private readonly database?: Database.Database;
  private readonly eventLog: PlatformEventLog;
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'ped' | 'pea') => string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: (attemptNo: number) => number;
  private readonly registrations = new Map<string, PlatformEventHandlerRegistration>();

  constructor(options: PlatformEventDispatcherOptions = {}) {
    this.database = options.db;
    this.eventLog = options.eventLog ?? new PlatformEventLog({ db: options.db });
    this.workerId = options.workerId
      ?? `platform-event-worker:${process.pid}:${generateSortableId('pew')}`;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs
      ?? ((attemptNo) => Math.min(30_000, 1_000 * (2 ** Math.max(0, attemptNo - 1))));
  }

  register(registration: PlatformEventHandlerRegistration): void {
    if (!registration.id.trim()) throw new Error('platform_event_handler_id_required');
    if (!registration.pattern.trim()) throw new Error('platform_event_handler_pattern_required');
    if (this.registrations.has(registration.id)) {
      throw new Error(`platform_event_handler_duplicate:${registration.id}`);
    }
    this.registrations.set(registration.id, registration);
  }

  recover(): DispatcherRecoveryResult {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      const expired = db.prepare(`
        SELECT id, handler_id, attempt_count FROM platform_event_delivery
        WHERE status = 'running' AND lease_expires_at <= ?
      `).all(now) as Array<{ id: string; handler_id: string; attempt_count: number }>;
      for (const delivery of expired) {
        const registration = this.registrations.get(delivery.handler_id);
        const exhausted = delivery.attempt_count >= (registration?.maxAttempts ?? 5);
        db.prepare(`
          UPDATE platform_event_delivery_attempt
          SET status = 'abandoned', finished_at = ?
          WHERE delivery_id = ? AND status = 'running'
        `).run(now, delivery.id);
        db.prepare(`
          UPDATE platform_event_delivery
          SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
              current_attempt_id = NULL, next_attempt_at = ?, updated_at = ?,
              completed_at = ?
          WHERE id = ? AND status = 'running'
        `).run(
          exhausted ? 'dead_letter' : 'queued',
          now,
          now,
          exhausted ? now : null,
          delivery.id,
        );
      }

      let enqueued = 0;
      const events = db.prepare(`
        SELECT id, type, stream_key, stream_sequence, recorded_at
        FROM platform_event
        ORDER BY recorded_at ASC, id ASC
      `).all() as Array<{
        id: string;
        type: string;
        stream_key: string;
        stream_sequence: number;
        recorded_at: string;
      }>;
      const insert = db.prepare(`
        INSERT OR IGNORE INTO platform_event_delivery (
          id, handler_id, event_id, stream_key, stream_sequence, status,
          attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
      `);
      for (const registration of this.registrations.values()) {
        if (registration.reliability !== 'durable') continue;
        for (const event of events) {
          if (!matches(registration.pattern, event.type)) continue;
          const result = insert.run(
            this.idFactory('ped'),
            registration.id,
            event.id,
            event.stream_key,
            event.stream_sequence,
            event.recorded_at,
            event.recorded_at,
            event.recorded_at,
          );
          enqueued += result.changes;
        }
      }
      return { enqueued, abandonedAttempts: expired.length };
    }).immediate();
  }

  async dispatchBestEffort(event: PlatformEvent): Promise<Array<{ handlerId: string; error: unknown }>> {
    const handlers = [...this.registrations.values()].filter(
      (registration) => (
        registration.reliability === 'best_effort'
        && matches(registration.pattern, event.type)
      ),
    );
    const results = await Promise.allSettled(
      handlers.map((registration) => this.runHandler(registration, event)),
    );
    return results.flatMap((result, index) => (
      result.status === 'rejected'
        ? [{ handlerId: handlers[index]!.id, error: result.reason }]
        : []
    ));
  }

  async drain(maxDeliveries = 100): Promise<DispatcherDrainResult> {
    const result: DispatcherDrainResult = { succeeded: 0, failed: 0, deadLettered: 0 };
    for (let index = 0; index < maxDeliveries; index += 1) {
      const claim = this.claimNext();
      if (!claim) break;
      const registration = this.registrations.get(claim.delivery.handler_id)!;
      const event = this.eventLog.getById(claim.delivery.event_id);
      if (!event) {
        this.fail(claim.delivery, claim.attemptId, registration, new Error('platform_event_missing'));
        result.failed += 1;
        continue;
      }
      try {
        await this.runHandler(registration, event);
        if (this.succeed(claim.delivery, claim.attemptId)) result.succeeded += 1;
      } catch (error) {
        const deadLettered = this.fail(claim.delivery, claim.attemptId, registration, error);
        result.failed += 1;
        if (deadLettered) result.deadLettered += 1;
      }
    }
    return result;
  }

  private claimNext(): { delivery: DeliveryRow; attemptId: string } | undefined {
    const durableIds = [...this.registrations.values()]
      .filter((registration) => registration.reliability === 'durable')
      .map((registration) => registration.id);
    if (durableIds.length === 0) return undefined;
    const db = this.database ?? getDb();
    const now = this.now();
    const nowIso = now.toISOString();
    const placeholders = durableIds.map(() => '?').join(',');
    return db.transaction(() => {
      const delivery = db.prepare(`
        SELECT candidate.*
        FROM platform_event_delivery candidate
        WHERE candidate.status = 'queued'
          AND candidate.next_attempt_at <= ?
          AND candidate.handler_id IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM platform_event_delivery predecessor
            WHERE predecessor.handler_id = candidate.handler_id
              AND predecessor.stream_key = candidate.stream_key
              AND predecessor.stream_sequence < candidate.stream_sequence
              AND predecessor.status NOT IN ('succeeded', 'dead_letter')
          )
        ORDER BY candidate.next_attempt_at ASC, candidate.created_at ASC, candidate.id ASC
        LIMIT 1
      `).get(nowIso, ...durableIds) as DeliveryRow | undefined;
      if (!delivery) return undefined;
      const leaseExpiresAt = new Date(now.getTime() + this.leaseMs).toISOString();
      const attemptNo = delivery.attempt_count + 1;
      const attemptId = this.idFactory('pea');
      const claimed = db.prepare(`
        UPDATE platform_event_delivery
        SET status = 'running', attempt_count = ?, lease_owner = ?,
            lease_expires_at = ?, current_attempt_id = ?, updated_at = ?
        WHERE id = ? AND status = 'queued'
      `).run(attemptNo, this.workerId, leaseExpiresAt, attemptId, nowIso, delivery.id);
      if (claimed.changes !== 1) return undefined;
      db.prepare(`
        INSERT INTO platform_event_delivery_attempt (
          id, delivery_id, attempt_no, worker_id, status, started_at
        ) VALUES (?, ?, ?, ?, 'running', ?)
      `).run(attemptId, delivery.id, attemptNo, this.workerId, nowIso);
      return {
        delivery: { ...delivery, attempt_count: attemptNo },
        attemptId,
      };
    }).immediate();
  }

  private succeed(delivery: DeliveryRow, attemptId: string): boolean {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      const updated = db.prepare(`
        UPDATE platform_event_delivery
        SET status = 'succeeded', lease_owner = NULL, lease_expires_at = NULL,
            current_attempt_id = NULL, last_error = NULL, updated_at = ?, completed_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND current_attempt_id = ?
      `).run(now, now, delivery.id, this.workerId, attemptId);
      if (updated.changes !== 1) return false;
      db.prepare(`
        UPDATE platform_event_delivery_attempt
        SET status = 'succeeded', finished_at = ?
        WHERE id = ? AND status = 'running'
      `).run(now, attemptId);
      return true;
    }).immediate();
  }

  private fail(
    delivery: DeliveryRow,
    attemptId: string,
    registration: PlatformEventHandlerRegistration,
    error: unknown,
  ): boolean {
    const db = this.database ?? getDb();
    const now = this.now();
    const nowIso = now.toISOString();
    const message = errorMessage(error);
    const deadLettered = delivery.attempt_count >= (registration.maxAttempts ?? 5);
    const nextAttemptAt = deadLettered
      ? nowIso
      : new Date(now.getTime() + this.retryDelayMs(delivery.attempt_count)).toISOString();
    return db.transaction(() => {
      const updated = db.prepare(`
        UPDATE platform_event_delivery
        SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
            current_attempt_id = NULL, next_attempt_at = ?, last_error = ?, updated_at = ?,
            completed_at = ?
        WHERE id = ? AND status = 'running' AND lease_owner = ?
          AND current_attempt_id = ?
      `).run(
        deadLettered ? 'dead_letter' : 'queued',
        nextAttemptAt,
        message,
        nowIso,
        deadLettered ? nowIso : null,
        delivery.id,
        this.workerId,
        attemptId,
      );
      if (updated.changes !== 1) return false;
      db.prepare(`
        UPDATE platform_event_delivery_attempt
        SET status = 'failed', finished_at = ?, error = ?
        WHERE id = ? AND status = 'running'
      `).run(nowIso, message, attemptId);
      return deadLettered;
    }).immediate();
  }

  private async runHandler(
    registration: PlatformEventHandlerRegistration,
    event: PlatformEvent,
  ): Promise<void> {
    const timeoutMs = registration.timeoutMs ?? this.leaseMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`platform_event_handler_timeout_invalid:${registration.id}`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(() => registration.handle(event)),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`platform_event_handler_timed_out:${registration.id}`)),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
