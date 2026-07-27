import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';

export type DurableEffectExecution = 'transactional' | 'idempotent';
export type DurableEffectStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'dead_letter'
  | 'cancelled'
  | 'superseded';
export type DurableEffectCriticality = 'blocking' | 'non_blocking';

export interface DurableEffect<TPayload = unknown> {
  id: string;
  sourceEventId: string;
  type: string;
  targetKey: string;
  laneKey: string;
  laneSequence: number;
  idempotencyKey: string;
  payload: TPayload;
  status: DurableEffectStatus;
  attemptCount: number;
  maxAttempts: number;
  criticality: DurableEffectCriticality;
  deliveryRunId?: string;
  appliesFromRevision: number;
  sourceActionId?: string;
  supersededAtRevision?: number;
  successorEffectId?: string;
  dispositionReason?: string;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface EnqueueDurableEffect {
  type: string;
  targetKey: string;
  payload: unknown;
  idempotencyKey?: string;
  criticality?: DurableEffectCriticality;
  deliveryRunId?: string;
  appliesFromRevision?: number;
  sourceActionId?: string;
}

export interface EnqueueDurableEffectBatch {
  sourceEventId: string;
  laneKey: string;
  effects: readonly EnqueueDurableEffect[];
}

export interface DurableEffectExecutionContext {
  signal: AbortSignal;
  idempotencyKey: string;
}

export interface DurableEffectAfterCommit {
  afterCommit(): void | Promise<void>;
}

interface DurableEffectRegistrationBase {
  type: string;
  maxAttempts?: number;
  timeoutMs?: number;
}

export interface TransactionalEffectRegistration extends DurableEffectRegistrationBase {
  execution: 'transactional';
  execute(
    effect: DurableEffect,
    context: DurableEffectExecutionContext,
  ): void | DurableEffectAfterCommit;
}

export interface IdempotentEffectRegistration extends DurableEffectRegistrationBase {
  execution: 'idempotent';
  execute(
    effect: DurableEffect,
    context: DurableEffectExecutionContext,
  ): void | Promise<void>;
}

export type DurableEffectRegistration =
  | TransactionalEffectRegistration
  | IdempotentEffectRegistration;

export interface DurableEffectRecoveryResult {
  recovered: number;
  abandonedAttempts: number;
  deadLettered: number;
}

export interface DurableEffectDrainResult {
  succeeded: number;
  failed: number;
  deadLettered: number;
  fenced: number;
}

export interface DurableEffectOutboxOptions {
  db?: Database.Database;
  workerId?: string;
  now?: () => Date;
  idFactory?: (prefix: 'pfx' | 'pfa') => string;
  leaseMs?: number;
  retryDelayMs?: (attempt: number) => number;
  onAfterCommitError?: (effect: DurableEffect, error: unknown) => void;
}

interface EffectRow {
  id: string;
  source_event_id: string;
  effect_type: string;
  target_key: string;
  lane_key: string;
  lane_sequence: number;
  idempotency_key: string;
  payload: string;
  status: DurableEffectStatus;
  attempt_count: number;
  max_attempts: number;
  criticality: DurableEffectCriticality;
  delivery_run_id: string | null;
  applies_from_revision: number;
  source_action_id: string | null;
  superseded_at_revision: number | null;
  successor_effect_id: string | null;
  disposition_reason: string | null;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  current_attempt_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class DurableEffectConflictError extends Error {
  readonly reasonCode = 'durable_effect_idempotency_conflict';

  constructor(readonly idempotencyKey: string) {
    super(`Durable effect idempotency key is already bound to different content: ${idempotencyKey}`);
    this.name = 'DurableEffectConflictError';
  }
}

export class DurableEffectRegistrationError extends Error {
  readonly reasonCode = 'durable_effect_registration_invalid';

  constructor(message: string) {
    super(message);
    this.name = 'DurableEffectRegistrationError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new Error('durable_effect_payload_not_serializable');
  return serialized;
}

function fromRow<TPayload = unknown>(row: EffectRow): DurableEffect<TPayload> {
  return {
    id: row.id,
    sourceEventId: row.source_event_id,
    type: row.effect_type,
    targetKey: row.target_key,
    laneKey: row.lane_key,
    laneSequence: row.lane_sequence,
    idempotencyKey: row.idempotency_key,
    payload: JSON.parse(row.payload) as TPayload,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    criticality: row.criticality,
    ...(row.delivery_run_id ? { deliveryRunId: row.delivery_run_id } : {}),
    appliesFromRevision: row.applies_from_revision,
    ...(row.source_action_id ? { sourceActionId: row.source_action_id } : {}),
    ...(row.superseded_at_revision !== null
      ? { supersededAtRevision: row.superseded_at_revision }
      : {}),
    ...(row.successor_effect_id ? { successorEffectId: row.successor_effect_id } : {}),
    ...(row.disposition_reason ? { dispositionReason: row.disposition_reason } : {}),
    nextAttemptAt: row.next_attempt_at,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
  };
}

function isAfterCommit(value: unknown): value is DurableEffectAfterCommit {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as DurableEffectAfterCommit).afterCommit === 'function',
  );
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value
    && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function',
  );
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 1_000);
}

export class DurableEffectOutbox {
  private readonly database?: Database.Database;
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'pfx' | 'pfa') => string;
  private readonly leaseMs: number;
  private readonly retryDelayMs: (attempt: number) => number;
  private readonly onAfterCommitError: (effect: DurableEffect, error: unknown) => void;
  private readonly registrations = new Map<string, DurableEffectRegistration>();

  constructor(options: DurableEffectOutboxOptions = {}) {
    this.database = options.db;
    this.workerId = options.workerId ?? generateSortableId('effect-worker');
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
    this.leaseMs = options.leaseMs ?? 30_000;
    this.retryDelayMs = options.retryDelayMs
      ?? ((attempt) => Math.min(30_000, 250 * (2 ** Math.max(0, attempt - 1))));
    this.onAfterCommitError = options.onAfterCommitError
      ?? ((effect, error) => {
        console.warn(`[platform-effect] afterCommit failed for ${effect.id}:`, error);
      });
  }

  register(registration: DurableEffectRegistration): void {
    if (!registration.type.trim()) {
      throw new DurableEffectRegistrationError('durable_effect_type_required');
    }
    if (this.registrations.has(registration.type)) {
      throw new DurableEffectRegistrationError(
        `durable_effect_registration_duplicate:${registration.type}`,
      );
    }
    if (
      registration.maxAttempts !== undefined
      && (!Number.isInteger(registration.maxAttempts) || registration.maxAttempts <= 0)
    ) {
      throw new DurableEffectRegistrationError(
        `durable_effect_max_attempts_invalid:${registration.type}`,
      );
    }
    if (
      registration.timeoutMs !== undefined
      && (!Number.isFinite(registration.timeoutMs) || registration.timeoutMs <= 0)
    ) {
      throw new DurableEffectRegistrationError(
        `durable_effect_timeout_invalid:${registration.type}`,
      );
    }
    this.registrations.set(registration.type, registration);
  }

  enqueueBatch(input: EnqueueDurableEffectBatch): DurableEffect[] {
    if (!input.sourceEventId.trim()) throw new Error('durable_effect_source_event_required');
    if (!input.laneKey.trim()) throw new Error('durable_effect_lane_required');
    if (input.effects.length === 0) return [];
    const db = this.database ?? getDb();
    return db.transaction(() => {
      let nextSequence = (
        db.prepare(
          'SELECT COALESCE(MAX(lane_sequence),0) AS sequence FROM platform_effect_outbox WHERE lane_key=?',
        ).get(input.laneKey) as { sequence: number }
      ).sequence + 1;
      const result: DurableEffect[] = [];
      for (const requested of input.effects) {
        if (!requested.type.trim()) throw new Error('durable_effect_type_required');
        if (!requested.targetKey.trim()) throw new Error('durable_effect_target_required');
        const idempotencyKey = requested.idempotencyKey
          ?? `effect:${input.sourceEventId}:${requested.type}:${requested.targetKey}`;
        const payload = canonicalJson(requested.payload);
        const criticality = requested.criticality ?? 'non_blocking';
        const appliesFromRevision = requested.appliesFromRevision ?? 0;
        if (!Number.isSafeInteger(appliesFromRevision) || appliesFromRevision < 0) {
          throw new Error('durable_effect_applies_revision_invalid');
        }
        const maxAttempts = this.registrations.get(requested.type)?.maxAttempts ?? 5;
        const existing = db.prepare(
          'SELECT * FROM platform_effect_outbox WHERE idempotency_key=?',
        ).get(idempotencyKey) as EffectRow | undefined;
        if (existing) {
          if (
            existing.source_event_id !== input.sourceEventId
            || existing.effect_type !== requested.type
            || existing.target_key !== requested.targetKey
            || existing.lane_key !== input.laneKey
            || existing.payload !== payload
            || existing.criticality !== criticality
            || existing.delivery_run_id !== (requested.deliveryRunId ?? null)
            || existing.applies_from_revision !== appliesFromRevision
            || existing.source_action_id !== (requested.sourceActionId ?? null)
          ) {
            throw new DurableEffectConflictError(idempotencyKey);
          }
          result.push(fromRow(existing));
          continue;
        }
        const now = this.now().toISOString();
        const id = this.idFactory('pfx');
        db.prepare(`
          INSERT INTO platform_effect_outbox (
            id,source_event_id,effect_type,target_key,lane_key,lane_sequence,
            idempotency_key,payload,status,attempt_count,next_attempt_at,
            max_attempts,criticality,delivery_run_id,applies_from_revision,
            source_action_id,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,'queued',0,?,?,?,?,?,?,?,?)
        `).run(
          id,
          input.sourceEventId,
          requested.type,
          requested.targetKey,
          input.laneKey,
          nextSequence,
          idempotencyKey,
          payload,
          now,
          maxAttempts,
          criticality,
          requested.deliveryRunId ?? null,
          appliesFromRevision,
          requested.sourceActionId ?? null,
          now,
          now,
        );
        result.push(this.get(id)!);
        nextSequence += 1;
      }
      return result;
    }).immediate();
  }

  get(id: string): DurableEffect | undefined {
    const row = (this.database ?? getDb()).prepare(
      'SELECT * FROM platform_effect_outbox WHERE id=?',
    ).get(id) as EffectRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listBySourceEvent(sourceEventId: string): DurableEffect[] {
    const rows = (this.database ?? getDb()).prepare(`
      SELECT * FROM platform_effect_outbox
      WHERE source_event_id=?
      ORDER BY lane_key,lane_sequence
    `).all(sourceEventId) as EffectRow[];
    return rows.map((row) => fromRow(row));
  }

  listApplicableBlocking(deliveryRunId: string, revision: number): DurableEffect[] {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('durable_effect_closure_revision_invalid');
    }
    const rows = (this.database ?? getDb()).prepare(`
      SELECT * FROM platform_effect_outbox
      WHERE delivery_run_id=?
        AND criticality='blocking'
        AND applies_from_revision<=?
        AND status NOT IN ('succeeded','cancelled','superseded')
      ORDER BY applies_from_revision,lane_key,lane_sequence,id
    `).all(deliveryRunId, revision) as EffectRow[];
    return rows.map((row) => fromRow(row));
  }

  cancel(input: { effectId: string; reason: string }): boolean {
    if (!input.reason.trim()) throw new Error('durable_effect_disposition_reason_required');
    const now = this.now().toISOString();
    return (this.database ?? getDb()).prepare(`
      UPDATE platform_effect_outbox
      SET status='cancelled',disposition_reason=?,lease_owner=NULL,lease_expires_at=NULL,
          current_attempt_id=NULL,updated_at=?,completed_at=?
      WHERE id=? AND status IN ('queued','dead_letter')
    `).run(input.reason.trim(), now, now, input.effectId).changes === 1;
  }

  supersede(input: {
    effectId: string;
    atRevision: number;
    reason: string;
    successorEffectId?: string;
  }): boolean {
    if (!Number.isSafeInteger(input.atRevision) || input.atRevision < 0) {
      throw new Error('durable_effect_superseded_revision_invalid');
    }
    if (!input.reason.trim()) throw new Error('durable_effect_disposition_reason_required');
    const now = this.now().toISOString();
    return (this.database ?? getDb()).prepare(`
      UPDATE platform_effect_outbox
      SET status='superseded',superseded_at_revision=?,successor_effect_id=?,
          disposition_reason=?,lease_owner=NULL,lease_expires_at=NULL,
          current_attempt_id=NULL,updated_at=?,completed_at=?
      WHERE id=? AND status IN ('queued','dead_letter')
        AND ? >= applies_from_revision
    `).run(
      input.atRevision,
      input.successorEffectId ?? null,
      input.reason.trim(),
      now,
      now,
      input.effectId,
      input.atRevision,
    ).changes === 1;
  }

  recover(): DurableEffectRecoveryResult {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      const expired = db.prepare(`
        SELECT * FROM platform_effect_outbox
        WHERE status='running' AND lease_expires_at <= ?
      `).all(now) as EffectRow[];
      let recovered = 0;
      let abandonedAttempts = 0;
      let deadLettered = 0;
      for (const effect of expired) {
        const exhausted = effect.attempt_count >= effect.max_attempts;
        const updated = db.prepare(`
          UPDATE platform_effect_outbox
          SET status=?, lease_owner=NULL, lease_expires_at=NULL,
              current_attempt_id=NULL, next_attempt_at=?, last_error=?,
              updated_at=?, completed_at=?
          WHERE id=? AND status='running' AND current_attempt_id=?
        `).run(
          exhausted ? 'dead_letter' : 'queued',
          now,
          'durable_effect_lease_expired',
          now,
          exhausted ? now : null,
          effect.id,
          effect.current_attempt_id,
        );
        if (updated.changes !== 1) continue;
        if (exhausted) deadLettered += 1;
        else recovered += 1;
        abandonedAttempts += db.prepare(`
          UPDATE platform_effect_attempt
          SET status='abandoned', finished_at=?, error='durable_effect_lease_expired'
          WHERE id=? AND status='running'
        `).run(now, effect.current_attempt_id).changes;
      }
      return { recovered, abandonedAttempts, deadLettered };
    }).immediate();
  }

  async drain(maxEffects = 100): Promise<DurableEffectDrainResult> {
    const result: DurableEffectDrainResult = {
      succeeded: 0,
      failed: 0,
      deadLettered: 0,
      fenced: 0,
    };
    const claims: Array<{
      row: EffectRow;
      effect: DurableEffect;
      attemptId: string;
      registration: DurableEffectRegistration;
    }> = [];
    for (let index = 0; index < maxEffects; index += 1) {
      const claim = this.claimNext();
      if (!claim) break;
      claims.push(claim);
    }
    await Promise.all(claims.map(async (claim) => {
      const transition = claim.registration.execution === 'transactional'
        ? await this.runTransactional({ ...claim, registration: claim.registration })
        : await this.runIdempotent({ ...claim, registration: claim.registration });
      if (transition === 'succeeded') result.succeeded += 1;
      if (transition === 'retry_queued') result.failed += 1;
      if (transition === 'dead_lettered') {
        result.failed += 1;
        result.deadLettered += 1;
      }
      if (transition === 'fenced') result.fenced += 1;
    }));
    return result;
  }

  private claimNext(): {
    row: EffectRow;
    effect: DurableEffect;
    attemptId: string;
    registration: DurableEffectRegistration;
  } | undefined {
    const registeredTypes = [...this.registrations.keys()];
    if (registeredTypes.length === 0) return undefined;
    const db = this.database ?? getDb();
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const placeholders = registeredTypes.map(() => '?').join(',');
    return db.transaction(() => {
      const row = db.prepare(`
        SELECT candidate.*
        FROM platform_effect_outbox candidate
        WHERE candidate.status='queued'
          AND candidate.next_attempt_at <= ?
          AND candidate.effect_type IN (${placeholders})
          AND NOT EXISTS (
            SELECT 1 FROM platform_effect_outbox predecessor
            WHERE predecessor.lane_key=candidate.lane_key
              AND predecessor.lane_sequence < candidate.lane_sequence
              AND predecessor.status NOT IN ('succeeded','dead_letter','cancelled','superseded')
          )
        ORDER BY candidate.next_attempt_at,candidate.created_at,candidate.id
        LIMIT 1
      `).get(now, ...registeredTypes) as EffectRow | undefined;
      if (!row) return undefined;
      const registration = this.registrations.get(row.effect_type)!;
      const attemptId = this.idFactory('pfa');
      const attemptNo = row.attempt_count + 1;
      const leaseExpiresAt = new Date(nowDate.getTime() + this.leaseMs).toISOString();
      const claimed = db.prepare(`
        UPDATE platform_effect_outbox
        SET status='running',attempt_count=?,lease_owner=?,lease_expires_at=?,
            current_attempt_id=?,updated_at=?
        WHERE id=? AND status='queued'
      `).run(
        attemptNo,
        this.workerId,
        leaseExpiresAt,
        attemptId,
        now,
        row.id,
      );
      if (claimed.changes !== 1) return undefined;
      db.prepare(`
        INSERT INTO platform_effect_attempt (
          id,effect_id,attempt_no,worker_id,status,started_at
        ) VALUES (?,?,?,?,'running',?)
      `).run(attemptId, row.id, attemptNo, this.workerId, now);
      const claimedRow = {
        ...row,
        status: 'running' as const,
        attempt_count: attemptNo,
        lease_owner: this.workerId,
        lease_expires_at: leaseExpiresAt,
        current_attempt_id: attemptId,
        updated_at: now,
      };
      return {
        row: claimedRow,
        effect: fromRow(claimedRow),
        attemptId,
        registration,
      };
    }).immediate();
  }

  private async runTransactional(claim: {
    row: EffectRow;
    effect: DurableEffect;
    attemptId: string;
    registration: TransactionalEffectRegistration;
  }): Promise<'succeeded' | 'retry_queued' | 'dead_lettered' | 'fenced'> {
    const db = this.database ?? getDb();
    let afterCommit: DurableEffectAfterCommit | undefined;
    try {
      db.transaction(() => {
        const active = db.prepare(`
          SELECT 1 FROM platform_effect_outbox
          WHERE id=? AND status='running' AND lease_owner=? AND current_attempt_id=?
        `).get(claim.effect.id, this.workerId, claim.attemptId);
        if (!active) throw new Error('durable_effect_attempt_fenced');
        const startedAt = Date.now();
        const controller = new AbortController();
        const executionResult = claim.registration.execute(claim.effect, {
          signal: controller.signal,
          idempotencyKey: claim.effect.idempotencyKey,
        });
        if (isPromiseLike(executionResult)) {
          void Promise.resolve(executionResult).catch(() => {});
          throw new DurableEffectRegistrationError(
            `durable_effect_transactional_adapter_async:${claim.registration.type}`,
          );
        }
        const timeoutMs = claim.registration.timeoutMs ?? this.leaseMs;
        if (Date.now() - startedAt > timeoutMs) {
          controller.abort();
          throw new Error(`durable_effect_timed_out:${claim.registration.type}`);
        }
        if (isAfterCommit(executionResult)) afterCommit = executionResult;
        const now = this.now().toISOString();
        const updated = db.prepare(`
          UPDATE platform_effect_outbox
          SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,
              current_attempt_id=NULL,last_error=NULL,updated_at=?,completed_at=?
          WHERE id=? AND status='running' AND lease_owner=? AND current_attempt_id=?
        `).run(
          now,
          now,
          claim.effect.id,
          this.workerId,
          claim.attemptId,
        );
        if (updated.changes !== 1) throw new Error('durable_effect_attempt_fenced');
        db.prepare(`
          UPDATE platform_effect_attempt
          SET status='succeeded',finished_at=?
          WHERE id=? AND status='running'
        `).run(now, claim.attemptId);
      }).immediate();
    } catch (error) {
      return this.fail(claim.row, claim.attemptId, claim.registration, error);
    }
    if (afterCommit) {
      try {
        await afterCommit.afterCommit();
      } catch (error) {
        this.onAfterCommitError(claim.effect, error);
      }
    }
    return 'succeeded';
  }

  private async runIdempotent(claim: {
    row: EffectRow;
    effect: DurableEffect;
    attemptId: string;
    registration: IdempotentEffectRegistration;
  }): Promise<'succeeded' | 'retry_queued' | 'dead_lettered' | 'fenced'> {
    const timeoutMs = claim.registration.timeoutMs ?? this.leaseMs;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const heartbeat = setInterval(
      () => this.extendLease(claim.effect.id, claim.attemptId),
      Math.max(10, Math.floor(this.leaseMs / 3)),
    );
    try {
      await claim.registration.execute(claim.effect, {
        signal: controller.signal,
        idempotencyKey: claim.effect.idempotencyKey,
      });
      if (timedOut) throw new Error(`durable_effect_timed_out:${claim.registration.type}`);
      return this.succeed(claim.effect.id, claim.attemptId)
        ? 'succeeded'
        : 'fenced';
    } catch (error) {
      return this.fail(claim.row, claim.attemptId, claim.registration, error);
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
    }
  }

  private succeed(effectId: string, attemptId: string): boolean {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      const updated = db.prepare(`
        UPDATE platform_effect_outbox
        SET status='succeeded',lease_owner=NULL,lease_expires_at=NULL,
            current_attempt_id=NULL,last_error=NULL,updated_at=?,completed_at=?
        WHERE id=? AND status='running' AND lease_owner=? AND current_attempt_id=?
      `).run(now, now, effectId, this.workerId, attemptId);
      if (updated.changes !== 1) return false;
      db.prepare(`
        UPDATE platform_effect_attempt
        SET status='succeeded',finished_at=?
        WHERE id=? AND status='running'
      `).run(now, attemptId);
      return true;
    }).immediate();
  }

  private fail(
    row: EffectRow,
    attemptId: string,
    registration: DurableEffectRegistration,
    error: unknown,
  ): 'retry_queued' | 'dead_lettered' | 'fenced' {
    const db = this.database ?? getDb();
    const nowDate = this.now();
    const now = nowDate.toISOString();
    const deadLettered = row.attempt_count >= row.max_attempts;
    const nextAttemptAt = deadLettered
      ? now
      : new Date(nowDate.getTime() + this.retryDelayMs(row.attempt_count)).toISOString();
    const message = errorMessage(error);
    return db.transaction(() => {
      const updated = db.prepare(`
        UPDATE platform_effect_outbox
        SET status=?,lease_owner=NULL,lease_expires_at=NULL,current_attempt_id=NULL,
            next_attempt_at=?,last_error=?,updated_at=?,completed_at=?
        WHERE id=? AND status='running' AND lease_owner=? AND current_attempt_id=?
      `).run(
        deadLettered ? 'dead_letter' : 'queued',
        nextAttemptAt,
        message,
        now,
        deadLettered ? now : null,
        row.id,
        this.workerId,
        attemptId,
      );
      if (updated.changes !== 1) return 'fenced' as const;
      db.prepare(`
        UPDATE platform_effect_attempt
        SET status='failed',finished_at=?,error=?
        WHERE id=? AND status='running'
      `).run(now, message, attemptId);
      return deadLettered ? 'dead_lettered' as const : 'retry_queued' as const;
    }).immediate();
  }

  private extendLease(effectId: string, attemptId: string): void {
    const db = this.database ?? getDb();
    const now = this.now();
    db.prepare(`
      UPDATE platform_effect_outbox
      SET lease_expires_at=?,updated_at=?
      WHERE id=? AND status='running' AND lease_owner=? AND current_attempt_id=?
    `).run(
      new Date(now.getTime() + this.leaseMs).toISOString(),
      now.toISOString(),
      effectId,
      this.workerId,
      attemptId,
    );
  }
}
