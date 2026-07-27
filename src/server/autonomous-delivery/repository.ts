import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { resolveGoalCorrelationId } from './types';
import type {
  DeliveryActionReceipt,
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

export class DeliveryRunIdempotencyConflictError extends Error {
  readonly reasonCode = 'delivery_run_idempotency_conflict';

  constructor(readonly idempotencyKey: string) {
    super(`Delivery start idempotency key is already bound to different content: ${idempotencyKey}`);
  }
}

export class ActiveDeliveryRunConflictError extends Error {
  readonly reasonCode = 'active_delivery_run_conflict';

  constructor(readonly conversationId: string, readonly runId: string) {
    super(`Conversation ${conversationId} already has active DeliveryRun ${runId}`);
  }
}

function nowIso(now: Date | string = new Date()): string {
  return typeof now === 'string' ? now : now.toISOString();
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

export class AutonomousDeliveryRepository {
  createRun(contract: GoalContract, now: Date = new Date()): DeliveryRunSnapshot {
    const timestamp = nowIso(now);
    const idempotencyKey = contract.idempotencyKey.trim();
    if (!idempotencyKey) throw new InvalidDeliveryRunStateError('new', 'idempotency key is required');
    const normalizedContract: GoalContract = {
      ...contract,
      correlationId: resolveGoalCorrelationId(contract),
    };
    const contractJson = JSON.stringify(canonicalize(normalizedContract));
    const id = generateSortableId('delivery');
    const db = getDb();
    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT id,goal_contract_json FROM autonomous_delivery_run
        WHERE start_idempotency_key=?
      `).get(idempotencyKey) as {
        id: string;
        goal_contract_json: string;
      } | undefined;
      if (existing) {
        const existingContract = JSON.parse(existing.goal_contract_json) as GoalContract;
        const normalizedExistingJson = JSON.stringify(canonicalize({
          ...existingContract,
          correlationId: resolveGoalCorrelationId(existingContract),
        }));
        if (normalizedExistingJson !== contractJson) {
          throw new DeliveryRunIdempotencyConflictError(idempotencyKey);
        }
        return this.getSnapshot(existing.id)!;
      }
      const active = db.prepare(`
        SELECT id FROM autonomous_delivery_run
        WHERE conversation_id=?
          AND status NOT IN ('completed','failed','cancelled')
        ORDER BY created_at DESC,id DESC LIMIT 1
      `).get(contract.scope.conversationId) as { id: string } | undefined;
      if (active) {
        throw new ActiveDeliveryRunConflictError(contract.scope.conversationId, active.id);
      }
      db.prepare(
      `INSERT INTO autonomous_delivery_run (
        id, conversation_id, start_idempotency_key, status, current_stage, goal_contract_json,
        repair_cycle, created_at, updated_at
      ) VALUES (?, ?, ?, 'active', 'planning', ?, 0, ?, ?)`,
      ).run(
        id,
        contract.scope.conversationId,
        idempotencyKey,
        contractJson,
        timestamp,
        timestamp,
      );
      new DomainEventPublisher(db).publish({
        type: 'delivery.run.started',
        projectId: contract.scope.conversationId,
        aggregate: { type: 'delivery_run', id },
        correlationId: normalizedContract.correlationId,
        causationId: normalizedContract.idempotencyKey,
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
    const receipts = getDb().prepare(
      'SELECT * FROM autonomous_delivery_receipt WHERE run_id=? ORDER BY observed_at ASC, id ASC',
    ).all(runId) as DeliveryReceiptRow[];
    return {
      run,
      contract: JSON.parse(run.goal_contract_json) as GoalContract,
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
          correlationId: resolveGoalCorrelationId(
            JSON.parse(current.goal_contract_json) as GoalContract,
          ),
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

  appendReceipt(input: {
    runId: string;
    receipt: DeliveryActionReceipt;
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
        id, run_id, kind, external_id, status,
        payload_json, idempotency_key, observed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        external_id=excluded.external_id,
        status=excluded.status,
        payload_json=excluded.payload_json,
        observed_at=excluded.observed_at`,
    ).run(
      id,
      input.runId,
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
