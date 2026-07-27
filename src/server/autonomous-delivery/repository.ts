import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import { DomainEventPublisher } from '../platform-events/domain-events';
import type {
  ClaimedDeliveryAction,
  DeliveryActionKind,
  DeliveryActionReceipt,
  DeliveryActionRow,
  DeliveryAttemptRow,
  DeliveryBundle,
  DeliveryReceiptRow,
  DeliveryRunRow,
  DeliveryRunSnapshot,
  DeliveryStage,
  DeliveryRunStatus,
  GoalContract,
} from './types';

const DELIVERY_RUN_TRANSITIONS: Readonly<
  Record<DeliveryRunStatus, ReadonlySet<DeliveryRunStatus>>
> = {
  active: new Set(['waiting_gate', 'waiting_human', 'retrying', 'completed', 'failed', 'cancelled']),
  waiting_gate: new Set(['active', 'waiting_human', 'completed', 'failed', 'cancelled']),
  waiting_human: new Set(['active', 'failed', 'cancelled']),
  retrying: new Set(['active', 'waiting_human', 'failed', 'cancelled']),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
};

export class InvalidDeliveryRunTransitionError extends Error {
  readonly reasonCode = 'invalid_delivery_run_transition';

  constructor(
    readonly runId: string,
    readonly from: DeliveryRunStatus,
    readonly to: DeliveryRunStatus,
  ) {
    super(`Illegal delivery run transition for ${runId}: ${from} -> ${to}`);
  }
}

export class InvalidDeliveryRunStateError extends Error {
  readonly reasonCode = 'invalid_delivery_run_state';

  constructor(
    readonly runId: string,
    readonly detail: string,
  ) {
    super(`Invalid delivery run state for ${runId}: ${detail}`);
  }
}

function nowIso(now: Date | string = new Date()): string {
  return typeof now === 'string' ? now : now.toISOString();
}

function addMs(iso: string, milliseconds: number): string {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

export class AutonomousDeliveryRepository {
  createRun(contract: GoalContract, now: Date = new Date()): DeliveryRunSnapshot {
    const timestamp = nowIso(now);
    const id = generateSortableId('delivery');
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
      `INSERT INTO autonomous_delivery_run (
        id, conversation_id, status, current_stage, goal_contract_json,
        repair_cycle, created_at, updated_at
      ) VALUES (?, ?, 'active', 'planning', ?, 0, ?, ?)`,
      ).run(id, contract.scope.conversationId, JSON.stringify(contract), timestamp, timestamp);
      new DomainEventPublisher(db).publish({
        type: 'delivery.run.started',
        projectId: contract.scope.conversationId,
        aggregate: { type: 'delivery_run', id },
        dedupeKey: `delivery:${id}:started`,
        occurredAt: timestamp,
        payload: { status: 'active', stage: 'planning' },
      });
      return this.getSnapshot(id)!;
    }).immediate();
  }

  getRun(runId: string): DeliveryRunRow | undefined {
    return getDb().prepare('SELECT * FROM autonomous_delivery_run WHERE id=?')
      .get(runId) as DeliveryRunRow | undefined;
  }

  getLatestByConversation(conversationId: string): DeliveryRunSnapshot | undefined {
    const row = getDb().prepare(
      `SELECT * FROM autonomous_delivery_run
       WHERE conversation_id=?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(conversationId) as DeliveryRunRow | undefined;
    return row ? this.getSnapshot(row.id) : undefined;
  }

  listReconcileCandidates(): DeliveryRunRow[] {
    return getDb().prepare(
      `SELECT * FROM autonomous_delivery_run
       WHERE status NOT IN ('waiting_human','completed','failed','cancelled')
       ORDER BY updated_at ASC, id ASC`,
    ).all() as DeliveryRunRow[];
  }

  getSnapshot(runId: string): DeliveryRunSnapshot | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    const actions = getDb().prepare(
      'SELECT * FROM autonomous_delivery_action WHERE run_id=? ORDER BY created_at ASC, id ASC',
    ).all(runId) as DeliveryActionRow[];
    const attempts = getDb().prepare(
      `SELECT at.* FROM autonomous_delivery_attempt at
       JOIN autonomous_delivery_action ac ON ac.id=at.action_id
       WHERE ac.run_id=? ORDER BY at.created_at ASC, at.id ASC`,
    ).all(runId) as DeliveryAttemptRow[];
    const receipts = getDb().prepare(
      'SELECT * FROM autonomous_delivery_receipt WHERE run_id=? ORDER BY observed_at ASC, id ASC',
    ).all(runId) as DeliveryReceiptRow[];
    return {
      run,
      contract: JSON.parse(run.goal_contract_json) as GoalContract,
      actions,
      attempts,
      receipts,
      bundle: run.delivery_bundle_json
        ? JSON.parse(run.delivery_bundle_json) as DeliveryBundle
        : undefined,
    };
  }

  transitionRun(input: {
    runId: string;
    to: DeliveryRunStatus;
    stage: DeliveryStage;
    rootTaskId?: string;
    repairCycle?: number;
    escalationCode?: string;
    escalationDetail?: string;
    bundle?: DeliveryBundle;
    expectedRevision: number;
    now?: Date;
  }): DeliveryRunRow | undefined {
    const timestamp = nowIso(input.now);
    const completedAt = ['completed', 'failed', 'cancelled'].includes(input.to)
      ? timestamp
      : null;
    const db = getDb();
    return db.transaction(() => {
      const previous = this.getRun(input.runId);
      if (!previous) return undefined;
      if (input.expectedRevision !== previous.revision) return undefined;
      if (
        previous.status !== input.to
        && !DELIVERY_RUN_TRANSITIONS[previous.status].has(input.to)
      ) {
        throw new InvalidDeliveryRunTransitionError(input.runId, previous.status, input.to);
      }
      const nextRootTaskId = input.rootTaskId ?? previous.root_task_id;
      const nextRepairCycle = input.repairCycle ?? previous.repair_cycle;
      const nextEscalationCode = input.escalationCode ?? null;
      const nextEscalationDetail = input.escalationDetail ?? null;
      const nextBundleJson = input.bundle
        ? JSON.stringify(input.bundle)
        : previous.delivery_bundle_json;
      const unchanged = previous.status === input.to
        && previous.current_stage === input.stage
        && previous.root_task_id === nextRootTaskId
        && previous.repair_cycle === nextRepairCycle
        && previous.escalation_code === nextEscalationCode
        && previous.escalation_detail === nextEscalationDetail
        && previous.delivery_bundle_json === nextBundleJson;
      if (unchanged) return previous;
      if (['completed', 'failed', 'cancelled'].includes(previous.status)) {
        throw new InvalidDeliveryRunTransitionError(input.runId, previous.status, input.to);
      }
      if (input.to === 'waiting_human' && !input.escalationCode?.trim()) {
        throw new InvalidDeliveryRunStateError(
          input.runId,
          'waiting_human requires an escalation code',
        );
      }
      if (input.to === 'completed' && !nextBundleJson) {
        throw new InvalidDeliveryRunStateError(
          input.runId,
          'completed requires a delivery bundle',
        );
      }
      const result = db.prepare(
        `UPDATE autonomous_delivery_run
         SET status=?, current_stage=?,
             root_task_id=COALESCE(?, root_task_id),
             repair_cycle=COALESCE(?, repair_cycle),
             revision=revision+1,
             escalation_code=?, escalation_detail=?,
             delivery_bundle_json=COALESCE(?, delivery_bundle_json),
             completed_at=?,
             updated_at=?
         WHERE id=? AND revision=? AND status=?`,
      ).run(
        input.to,
        input.stage,
        input.rootTaskId ?? null,
        input.repairCycle ?? null,
        input.escalationCode ?? null,
        input.escalationDetail ?? null,
        input.bundle ? JSON.stringify(input.bundle) : null,
        completedAt,
        timestamp,
        input.runId,
        input.expectedRevision,
        previous.status,
      );
      if (result.changes !== 1) return undefined;
      const current = this.getRun(input.runId)!;
      if (
        previous.status !== current.status
        || previous.current_stage !== current.current_stage
      ) {
        const type = current.status === 'completed'
          ? 'delivery.run.completed'
          : current.status === 'waiting_human'
            ? 'delivery.run.waiting_human'
            : current.status === 'failed'
              ? 'delivery.run.failed'
              : current.status === 'cancelled'
                ? 'delivery.run.cancelled'
                : 'delivery.run.state_changed';
        new DomainEventPublisher(db).publish({
          type,
          projectId: current.conversation_id,
          aggregate: { type: 'delivery_run', id: current.id, version: current.revision },
          occurredAt: timestamp,
          payload: type === 'delivery.run.state_changed'
            ? {
                previousStatus: previous.status,
                status: current.status,
                previousStage: previous.current_stage,
                stage: current.current_stage,
              }
            : {
                previousStatus: previous.status,
                status: current.status,
                stage: current.current_stage,
                ...(type === 'delivery.run.waiting_human' && current.escalation_code
                  ? { code: current.escalation_code }
                  : {}),
              } as never,
        });
      }
      return current;
    }).immediate();
  }

  ensureAction(input: {
    runId: string;
    kind: DeliveryActionKind;
    idempotencyKey: string;
    maxAttempts: number;
    subjectType?: string;
    subjectId?: string;
    notBefore?: Date;
    now?: Date;
  }): DeliveryActionRow {
    const timestamp = nowIso(input.now);
    const id = generateSortableId('delivery-action');
    getDb().prepare(
      `INSERT INTO autonomous_delivery_action (
        id, run_id, kind, subject_type, subject_id, idempotency_key, status,
        not_before, attempt_count, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'ready', ?, 0, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING`,
    ).run(
      id,
      input.runId,
      input.kind,
      input.subjectType ?? null,
      input.subjectId ?? null,
      input.idempotencyKey,
      nowIso(input.notBefore ?? timestamp),
      input.maxAttempts,
      timestamp,
      timestamp,
    );
    return getDb().prepare('SELECT * FROM autonomous_delivery_action WHERE idempotency_key=?')
      .get(input.idempotencyKey) as DeliveryActionRow;
  }

  claimNext(input: {
    runId: string;
    workerId: string;
    leaseMs: number;
    now?: Date;
  }): ClaimedDeliveryAction | undefined {
    const timestamp = nowIso(input.now);
    const db = getDb();
    return db.transaction(() => {
      const candidate = db.prepare(
        `SELECT action.* FROM autonomous_delivery_action action
         JOIN autonomous_delivery_run run ON run.id=action.run_id
         WHERE action.run_id=?
           AND run.status NOT IN ('completed','failed','cancelled','waiting_human')
           AND action.status IN ('ready','retry_wait')
           AND action.not_before<=?
           AND action.attempt_count<action.max_attempts
         ORDER BY action.created_at ASC, action.id ASC
         LIMIT 1`,
      ).get(input.runId, timestamp) as DeliveryActionRow | undefined;
      if (!candidate) return undefined;

      const claimed = db.prepare(
        `UPDATE autonomous_delivery_action
         SET status='claimed', attempt_count=attempt_count+1, updated_at=?
         WHERE id=?
           AND status IN ('ready','retry_wait')
           AND not_before<=?
           AND attempt_count<max_attempts`,
      ).run(timestamp, candidate.id, timestamp);
      if (claimed.changes !== 1) return undefined;

      const action = db.prepare('SELECT * FROM autonomous_delivery_action WHERE id=?')
        .get(candidate.id) as DeliveryActionRow;
      const attemptId = generateSortableId('delivery-attempt');
      const leaseExpiresAt = addMs(timestamp, input.leaseMs);
      db.prepare(
        `INSERT INTO autonomous_delivery_attempt (
          id, action_id, attempt_no, status, lease_owner, lease_expires_at,
          heartbeat_at, created_at
        ) VALUES (?, ?, ?, 'claimed', ?, ?, ?, ?)`,
      ).run(
        attemptId,
        action.id,
        action.attempt_count,
        input.workerId,
        leaseExpiresAt,
        timestamp,
        timestamp,
      );
      new DomainEventPublisher(db).publish({
        type: 'delivery.action.claimed',
        projectId: (db.prepare(
          'SELECT conversation_id FROM autonomous_delivery_run WHERE id=?',
        ).get(input.runId) as { conversation_id: string }).conversation_id,
        aggregate: { type: 'delivery_action', id: action.id },
        occurredAt: timestamp,
        payload: {
          runId: input.runId,
          attemptId,
          attemptNo: action.attempt_count,
        },
      });
      return {
        action,
        attempt: db.prepare('SELECT * FROM autonomous_delivery_attempt WHERE id=?')
          .get(attemptId) as DeliveryAttemptRow,
      };
    })();
  }

  markAttemptRunning(attemptId: string, now: Date = new Date()): DeliveryAttemptRow | undefined {
    const timestamp = nowIso(now);
    const db = getDb();
    db.transaction(() => {
      const attempt = db.prepare('SELECT action_id FROM autonomous_delivery_attempt WHERE id=?')
        .get(attemptId) as { action_id: string } | undefined;
      if (!attempt) return;
      db.prepare(
        `UPDATE autonomous_delivery_attempt
         SET status='running', started_at=COALESCE(started_at, ?), heartbeat_at=?
         WHERE id=? AND status='claimed'`,
      ).run(timestamp, timestamp, attemptId);
      db.prepare(
        `UPDATE autonomous_delivery_action SET status='running', updated_at=?
         WHERE id=? AND status='claimed'`,
      ).run(timestamp, attempt.action_id);
    })();
    return getDb().prepare('SELECT * FROM autonomous_delivery_attempt WHERE id=?')
      .get(attemptId) as DeliveryAttemptRow | undefined;
  }

  heartbeat(attemptId: string, leaseMs: number, now: Date = new Date()): boolean {
    const timestamp = nowIso(now);
    const result = getDb().prepare(
      `UPDATE autonomous_delivery_attempt
       SET heartbeat_at=?, lease_expires_at=?
       WHERE id=? AND status IN ('claimed','running')
         AND EXISTS (
           SELECT 1 FROM autonomous_delivery_action action
           WHERE action.id=autonomous_delivery_attempt.action_id
             AND action.status IN ('claimed','running')
             AND action.attempt_count=autonomous_delivery_attempt.attempt_no
         )`,
    ).run(timestamp, addMs(timestamp, leaseMs), attemptId);
    return result.changes === 1;
  }

  completeAttempt(input: {
    runId: string;
    actionId: string;
    attemptId: string;
    receipts?: DeliveryActionReceipt[];
    now?: Date;
  }): boolean {
    const timestamp = nowIso(input.now);
    const db = getDb();
    return db.transaction(() => {
      const completed = db.prepare(
        `UPDATE autonomous_delivery_attempt
         SET status='succeeded', completed_at=?, heartbeat_at=?
         WHERE id=? AND action_id=? AND status IN ('claimed','running')
           AND EXISTS (
             SELECT 1 FROM autonomous_delivery_action action
             WHERE action.id=?
               AND action.status IN ('claimed','running')
               AND action.attempt_count=autonomous_delivery_attempt.attempt_no
           )`,
      ).run(timestamp, timestamp, input.attemptId, input.actionId, input.actionId);
      if (completed.changes !== 1) return false;
      const actionCompleted = db.prepare(
        `UPDATE autonomous_delivery_action
         SET status='succeeded', last_failure_code=NULL, last_failure_detail=NULL, updated_at=?
         WHERE id=? AND status IN ('claimed','running')
           AND attempt_count=(
             SELECT attempt_no FROM autonomous_delivery_attempt WHERE id=?
           )`,
      ).run(timestamp, input.actionId, input.attemptId);
      if (actionCompleted.changes !== 1) {
        throw new Error(`Delivery action lost ownership while completing: ${input.actionId}`);
      }
      const run = this.getRun(input.runId)!;
      new DomainEventPublisher(db).publish({
        type: 'delivery.action.succeeded',
        projectId: run.conversation_id,
        aggregate: { type: 'delivery_action', id: input.actionId },
        occurredAt: timestamp,
        payload: { runId: input.runId, attemptId: input.attemptId },
      });
      for (const [index, receipt] of (input.receipts ?? []).entries()) {
        this.appendReceipt({
          runId: input.runId,
          actionId: input.actionId,
          attemptId: input.attemptId,
          receipt,
          fallbackKey: `${input.actionId}:${input.attemptId}:${receipt.kind}:${index}`,
          now: timestamp,
        });
      }
      return true;
    })();
  }

  recordReceipt(input: {
    runId: string;
    receipt: DeliveryActionReceipt;
    now?: Date;
  }): DeliveryReceiptRow {
    const timestamp = nowIso(input.now);
    getDb().transaction(() => {
      this.appendReceipt({
        runId: input.runId,
        receipt: input.receipt,
        fallbackKey: `${input.runId}:${input.receipt.kind}:${input.receipt.externalId ?? 'observation'}`,
        now: timestamp,
      });
    })();
    return getDb().prepare(
      'SELECT * FROM autonomous_delivery_receipt WHERE idempotency_key=?',
    ).get(
      input.receipt.idempotencyKey
        ?? `${input.runId}:${input.receipt.kind}:${input.receipt.externalId ?? 'observation'}`,
    ) as DeliveryReceiptRow;
  }

  failAttempt(input: {
    actionId: string;
    attemptId: string;
    failureCode: string;
    failureDetail?: string;
    retryAt?: Date;
    now?: Date;
  }): 'retry_wait' | 'failed' | 'stale' {
    const timestamp = nowIso(input.now);
    const db = getDb();
    return db.transaction(() => {
      const action = db.prepare('SELECT * FROM autonomous_delivery_action WHERE id=?')
        .get(input.actionId) as DeliveryActionRow | undefined;
      if (!action) throw new Error(`Delivery action not found: ${input.actionId}`);
      const retry = Boolean(input.retryAt) && action.attempt_count < action.max_attempts;
      const failed = db.prepare(
        `UPDATE autonomous_delivery_attempt
         SET status='failed', completed_at=?, heartbeat_at=?, failure_code=?, failure_detail=?
         WHERE id=? AND action_id=? AND status IN ('claimed','running')
           AND EXISTS (
             SELECT 1 FROM autonomous_delivery_action current_action
             WHERE current_action.id=?
               AND current_action.status IN ('claimed','running')
               AND current_action.attempt_count=autonomous_delivery_attempt.attempt_no
           )`,
      ).run(
        timestamp,
        timestamp,
        input.failureCode,
        input.failureDetail ?? null,
        input.attemptId,
        input.actionId,
        input.actionId,
      );
      if (failed.changes !== 1) return 'stale';
      const actionFailed = db.prepare(
        `UPDATE autonomous_delivery_action
         SET status=?, not_before=?, last_failure_code=?, last_failure_detail=?, updated_at=?
         WHERE id=? AND status IN ('claimed','running')
           AND attempt_count=(
             SELECT attempt_no FROM autonomous_delivery_attempt WHERE id=?
           )`,
      ).run(
        retry ? 'retry_wait' : 'failed',
        retry ? nowIso(input.retryAt!) : timestamp,
        input.failureCode,
        input.failureDetail ?? null,
        timestamp,
        input.actionId,
        input.attemptId,
      );
      if (actionFailed.changes !== 1) {
        throw new Error(`Delivery action lost ownership while failing: ${input.actionId}`);
      }
      const run = db.prepare(
        `SELECT run.conversation_id, action.run_id
         FROM autonomous_delivery_action action
         JOIN autonomous_delivery_run run ON run.id=action.run_id
         WHERE action.id=?`,
      ).get(input.actionId) as { conversation_id: string; run_id: string };
      new DomainEventPublisher(db).publish({
        type: 'delivery.action.failed',
        projectId: run.conversation_id,
        aggregate: { type: 'delivery_action', id: input.actionId },
        occurredAt: timestamp,
        payload: {
          runId: run.run_id,
          attemptId: input.attemptId,
          failureCode: input.failureCode,
          retrying: retry,
        },
      });
      return retry ? 'retry_wait' : 'failed';
    })();
  }

  abandonExpiredAttempts(now: Date = new Date()): number {
    const timestamp = nowIso(now);
    const db = getDb();
    return db.transaction(() => {
      const expired = db.prepare(
        `SELECT at.id, at.action_id
         FROM autonomous_delivery_attempt at
         WHERE at.status IN ('claimed','running') AND at.lease_expires_at<?`,
      ).all(timestamp) as Array<{ id: string; action_id: string }>;
      for (const attempt of expired) {
        db.prepare(
          `UPDATE autonomous_delivery_attempt
           SET status='abandoned', completed_at=?, failure_code='transient_runtime',
               failure_detail='attempt lease expired'
           WHERE id=? AND status IN ('claimed','running')`,
        ).run(timestamp, attempt.id);
        db.prepare(
          `UPDATE autonomous_delivery_action
           SET status=CASE WHEN attempt_count<max_attempts THEN 'retry_wait' ELSE 'failed' END,
               not_before=?, last_failure_code='transient_runtime',
               last_failure_detail='attempt lease expired', updated_at=?
           WHERE id=? AND status IN ('claimed','running')`,
        ).run(timestamp, timestamp, attempt.action_id);
      }
      return expired.length;
    })();
  }

  appendReceipt(input: {
    runId: string;
    receipt: DeliveryActionReceipt;
    actionId?: string;
    attemptId?: string;
    fallbackKey?: string;
    now?: Date | string;
  }): DeliveryReceiptRow {
    const timestamp = nowIso(input.now);
    const idempotencyKey = input.receipt.idempotencyKey
      ?? input.fallbackKey
      ?? `${input.runId}:${input.receipt.kind}:${input.receipt.externalId ?? input.receipt.status}`;
    const id = generateSortableId('delivery-receipt');
    getDb().prepare(
      `INSERT INTO autonomous_delivery_receipt (
        id, run_id, action_id, attempt_id, kind, external_id, status,
        payload_json, idempotency_key, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        external_id=excluded.external_id,
        status=excluded.status,
        payload_json=excluded.payload_json,
        observed_at=excluded.observed_at`,
    ).run(
      id,
      input.runId,
      input.actionId ?? null,
      input.attemptId ?? null,
      input.receipt.kind,
      input.receipt.externalId ?? null,
      input.receipt.status,
      JSON.stringify(input.receipt.payload ?? {}),
      idempotencyKey,
      timestamp,
    );
    return getDb().prepare('SELECT * FROM autonomous_delivery_receipt WHERE idempotency_key=?')
      .get(idempotencyKey) as DeliveryReceiptRow;
  }
}

export const autonomousDeliveryRepo = new AutonomousDeliveryRepository();
