import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
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
  DeliveryRunStatus,
  GoalContract,
} from './types';

function nowIso(now: Date | string = new Date()): string {
  return typeof now === 'string' ? now : now.toISOString();
}

function addMs(iso: string, milliseconds: number): string {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function deliveryStartKey(contract: GoalContract): string {
  return contract.idempotencyKey?.trim() || `delivery-start:${contract.scope.conversationId}`;
}

export function normalizeDeliveryStartContract(contract: GoalContract): GoalContract {
  return { ...contract, idempotencyKey: deliveryStartKey(contract) };
}

export function isExactDeliveryStartReplay(
  requested: GoalContract,
  stored: GoalContract,
): boolean {
  return canonicalJson(normalizeDeliveryStartContract(requested))
    === canonicalJson(normalizeDeliveryStartContract(stored));
}

const preparedDeliveryDatabases = new WeakSet<Database.Database>();

function tableColumns(db: Database.Database, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
}

function usesManagedRunLifecycle(db: Database.Database): boolean {
  return tableColumns(db, 'autonomous_delivery_run').has('start_idempotency_key');
}

function prepareDeliveryCompatibility(db: Database.Database): Database.Database {
  if (preparedDeliveryDatabases.has(db)) return db;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS autonomous_delivery_action (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES autonomous_delivery_run(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        subject_type TEXT,
        subject_id TEXT,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN (
          'ready','claimed','running','retry_wait','succeeded','failed','cancelled'
        )),
        not_before TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL,
        last_failure_code TEXT,
        last_failure_detail TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_action_claim
        ON autonomous_delivery_action(run_id, status, not_before, created_at);

      CREATE TABLE IF NOT EXISTS autonomous_delivery_attempt (
        id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL REFERENCES autonomous_delivery_action(id) ON DELETE CASCADE,
        attempt_no INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN (
          'claimed','running','succeeded','failed','abandoned'
        )),
        lease_owner TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        heartbeat_at TEXT NOT NULL,
        workdir_ref TEXT,
        session_generation INTEGER,
        execution_envelope_id TEXT REFERENCES execution_envelope(id),
        failure_code TEXT,
        failure_detail TEXT,
        created_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        UNIQUE(action_id, attempt_no)
      );
      CREATE INDEX IF NOT EXISTS idx_autonomous_delivery_attempt_lease
        ON autonomous_delivery_attempt(status, lease_expires_at);
    `);

    const receiptColumns = tableColumns(db, 'autonomous_delivery_receipt');
    if (!receiptColumns.has('action_id')) {
      db.exec('ALTER TABLE autonomous_delivery_receipt ADD COLUMN action_id TEXT');
    }
    if (!receiptColumns.has('attempt_id')) {
      db.exec('ALTER TABLE autonomous_delivery_receipt ADD COLUMN attempt_id TEXT');
    }
  }).immediate();
  preparedDeliveryDatabases.add(db);
  return db;
}

function deliveryDb(): Database.Database {
  return prepareDeliveryCompatibility(getDb());
}

type StoredDeliveryRunRow = Omit<DeliveryRunRow, 'status'> & {
  status: DeliveryRunStatus | 'active' | 'waiting_gate' | 'waiting_human' | 'retrying' | 'failed';
};

function normalizeRun(db: Database.Database, row: StoredDeliveryRunRow): DeliveryRunRow {
  if (!usesManagedRunLifecycle(db)) return row as DeliveryRunRow;
  const status: DeliveryRunStatus = (() => {
    switch (row.status) {
      case 'active':
        return row.current_stage as DeliveryRunStatus;
      case 'waiting_gate':
      case 'waiting_human':
      case 'failed':
        return 'escalated';
      case 'retrying':
        return 'recovering';
      default:
        return row.status;
    }
  })();
  return { ...row, status };
}

function managedStatus(status: DeliveryRunStatus): StoredDeliveryRunRow['status'] {
  switch (status) {
    case 'escalated':
      return 'waiting_human';
    case 'recovering':
      return 'retrying';
    case 'completed':
    case 'cancelled':
      return status;
    default:
      return 'active';
  }
}

function managedStage(status: DeliveryRunStatus, stage: string): string {
  const allowed = new Set(['planning', 'executing', 'reviewing', 'verifying', 'integrating', 'delivering']);
  if (allowed.has(stage)) return stage;
  if (allowed.has(status)) return status;
  return status === 'completed' ? 'delivering' : 'planning';
}

export class AutonomousDeliveryRepository {
  createRun(contract: GoalContract, now: Date = new Date()): DeliveryRunSnapshot {
    const timestamp = nowIso(now);
    const id = generateSortableId('delivery');
    const db = deliveryDb();
    if (usesManagedRunLifecycle(db)) {
      return db.transaction(() => {
        const normalizedContract = normalizeDeliveryStartContract(contract);
        const startKey = normalizedContract.idempotencyKey!;
        const existingByKey = db.prepare(
          `SELECT id, conversation_id, goal_contract_json
           FROM autonomous_delivery_run WHERE start_idempotency_key=?`,
        ).get(startKey) as {
          id: string;
          conversation_id: string;
          goal_contract_json: string;
        } | undefined;
        if (existingByKey) {
          const storedContract = JSON.parse(existingByKey.goal_contract_json) as GoalContract;
          if (
            existingByKey.conversation_id !== contract.scope.conversationId
            || !isExactDeliveryStartReplay(normalizedContract, storedContract)
          ) {
            throw new Error('delivery_run_start_idempotency_conflict');
          }
          return this.getSnapshot(existingByKey.id)!;
        }

        const activeForConversation = db.prepare(
          `SELECT id FROM autonomous_delivery_run
           WHERE conversation_id=?
             AND status IN ('active','waiting_gate','waiting_human','retrying')
           LIMIT 1`,
        ).get(contract.scope.conversationId) as { id: string } | undefined;
        if (activeForConversation) {
          throw new Error('autonomous_delivery_active_run_conflict');
        }

        db.prepare(
          `INSERT INTO autonomous_delivery_run (
            id, conversation_id, status, current_stage, goal_contract_json,
            repair_cycle, start_idempotency_key, created_at, updated_at
          ) VALUES (?, ?, 'active', 'planning', ?, 0, ?, ?, ?)
          ON CONFLICT(start_idempotency_key) DO NOTHING`,
        ).run(
          id,
          contract.scope.conversationId,
          JSON.stringify(normalizedContract),
          startKey,
          timestamp,
          timestamp,
        );
        const createdOrExisting = db.prepare(
          `SELECT id, conversation_id, goal_contract_json
           FROM autonomous_delivery_run WHERE start_idempotency_key=?`,
        ).get(startKey) as {
          id: string;
          conversation_id: string;
          goal_contract_json: string;
        };
        const storedContract = JSON.parse(createdOrExisting.goal_contract_json) as GoalContract;
        if (
          createdOrExisting.conversation_id !== contract.scope.conversationId
          || !isExactDeliveryStartReplay(normalizedContract, storedContract)
        ) {
          throw new Error('delivery_run_start_idempotency_conflict');
        }
        return this.getSnapshot(createdOrExisting.id)!;
      }).immediate();
    }
    db.prepare(
      `INSERT INTO autonomous_delivery_run (
        id, conversation_id, status, current_stage, goal_contract_json,
        repair_cycle, created_at, updated_at
      ) VALUES (?, ?, 'submitted', 'planning', ?, 0, ?, ?)`,
    ).run(id, contract.scope.conversationId, JSON.stringify(contract), timestamp, timestamp);
    return this.getSnapshot(id)!;
  }

  getRun(runId: string): DeliveryRunRow | undefined {
    const db = deliveryDb();
    const row = db.prepare('SELECT * FROM autonomous_delivery_run WHERE id=?')
      .get(runId) as StoredDeliveryRunRow | undefined;
    return row ? normalizeRun(db, row) : undefined;
  }

  getLatestByConversation(conversationId: string): DeliveryRunSnapshot | undefined {
    const row = deliveryDb().prepare(
      `SELECT * FROM autonomous_delivery_run
       WHERE conversation_id=?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    ).get(conversationId) as StoredDeliveryRunRow | undefined;
    return row ? this.getSnapshot(row.id) : undefined;
  }

  listConversationIds(): string[] {
    return (deliveryDb().prepare(
      'SELECT DISTINCT conversation_id FROM autonomous_delivery_run ORDER BY conversation_id',
    ).all() as Array<{ conversation_id: string }>).map((row) => row.conversation_id);
  }

  listActive(): DeliveryRunRow[] {
    const db = deliveryDb();
    const activePredicate = usesManagedRunLifecycle(db)
      ? "status IN ('active','retrying')"
      : "status NOT IN ('completed','escalated','cancelled')";
    const rows = db.prepare(
      `SELECT * FROM autonomous_delivery_run
       WHERE ${activePredicate}
       ORDER BY updated_at ASC, id ASC`,
    ).all() as StoredDeliveryRunRow[];
    return rows.map((row) => normalizeRun(db, row));
  }

  getSnapshot(runId: string): DeliveryRunSnapshot | undefined {
    const run = this.getRun(runId);
    if (!run) return undefined;
    const actions = deliveryDb().prepare(
      'SELECT * FROM autonomous_delivery_action WHERE run_id=? ORDER BY created_at ASC, id ASC',
    ).all(runId) as DeliveryActionRow[];
    const attempts = deliveryDb().prepare(
      `SELECT at.* FROM autonomous_delivery_attempt at
       JOIN autonomous_delivery_action ac ON ac.id=at.action_id
       WHERE ac.run_id=? ORDER BY at.created_at ASC, at.id ASC`,
    ).all(runId) as DeliveryAttemptRow[];
    const receipts = deliveryDb().prepare(
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

  updateRun(input: {
    runId: string;
    status: DeliveryRunStatus;
    stage: string;
    rootTaskId?: string;
    repairCycle?: number;
    escalationCode?: string;
    escalationDetail?: string;
    bundle?: DeliveryBundle;
    expectedRevision?: number;
    now?: Date;
  }): DeliveryRunRow | undefined {
    const timestamp = nowIso(input.now);
    const db = deliveryDb();
    const managed = usesManagedRunLifecycle(db);
    const storedStatus = managed ? managedStatus(input.status) : input.status;
    const storedStage = managed ? managedStage(input.status, input.stage) : input.stage;
    const completedAt = storedStatus === 'completed' || storedStatus === 'failed'
      || storedStatus === 'cancelled' ? timestamp : null;
    const terminalStatuses = managed
      ? "'completed','failed','cancelled'"
      : "'completed','escalated','cancelled'";
    const result = db.prepare(
      `UPDATE autonomous_delivery_run
       SET status=?, current_stage=?,
           root_task_id=COALESCE(?, root_task_id),
           repair_cycle=COALESCE(?, repair_cycle),
           revision=revision+1,
           escalation_code=?, escalation_detail=?,
           delivery_bundle_json=COALESCE(?, delivery_bundle_json),
           completed_at=COALESCE(?, completed_at),
           updated_at=?
       WHERE id=?
         AND (? IS NULL OR revision=?)
         AND (? IS NULL OR status NOT IN (${terminalStatuses}))`,
    ).run(
      storedStatus,
      storedStage,
      input.rootTaskId ?? null,
      input.repairCycle ?? null,
      input.escalationCode ?? null,
      input.escalationDetail ?? null,
      input.bundle ? JSON.stringify(input.bundle) : null,
      completedAt,
      timestamp,
      input.runId,
      input.expectedRevision ?? null,
      input.expectedRevision ?? null,
      input.expectedRevision ?? null,
    );
    return result.changes === 1 ? this.getRun(input.runId) : undefined;
  }

  resumeEscalatedRun(input: {
    runId: string;
    expectedRevision: number;
    now?: Date;
  }): DeliveryRunRow | undefined {
    const timestamp = nowIso(input.now);
    const db = deliveryDb();
    const managed = usesManagedRunLifecycle(db);
    const resumableStatus = managed ? 'waiting_human' : 'escalated';
    const resumedStatus = managed ? 'active' : 'recovering';
    const result = db.prepare(
      `UPDATE autonomous_delivery_run
       SET status=?,
           revision=revision+1,
           escalation_code=NULL,
           escalation_detail=NULL,
           updated_at=?
       WHERE id=?
         AND revision=?
         AND status=?`,
    ).run(
      resumedStatus,
      timestamp,
      input.runId,
      input.expectedRevision,
      resumableStatus,
    );
    return result.changes === 1 ? this.getRun(input.runId) : undefined;
  }

  rearmFailedAction(input: {
    runId: string;
    actionId: string;
    additionalAttempts: number;
    now?: Date;
  }): DeliveryActionRow | undefined {
    const timestamp = nowIso(input.now);
    const result = deliveryDb().prepare(
      `UPDATE autonomous_delivery_action
       SET status='retry_wait',
           not_before=?,
           max_attempts=MAX(max_attempts, attempt_count + ?),
           updated_at=?
       WHERE id=?
         AND run_id=?
         AND status='failed'`,
    ).run(
      timestamp,
      Math.max(1, input.additionalAttempts),
      timestamp,
      input.actionId,
      input.runId,
    );
    return result.changes === 1
      ? deliveryDb().prepare('SELECT * FROM autonomous_delivery_action WHERE id=?')
        .get(input.actionId) as DeliveryActionRow
      : undefined;
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
    deliveryDb().prepare(
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
    return deliveryDb().prepare('SELECT * FROM autonomous_delivery_action WHERE idempotency_key=?')
      .get(input.idempotencyKey) as DeliveryActionRow;
  }

  claimNext(input: {
    runId: string;
    workerId: string;
    leaseMs: number;
    now?: Date;
  }): ClaimedDeliveryAction | undefined {
    const timestamp = nowIso(input.now);
    const db = deliveryDb();
    const activePredicate = usesManagedRunLifecycle(db)
      ? "run.status IN ('active','retrying')"
      : "run.status NOT IN ('completed','escalated','cancelled')";
    return db.transaction(() => {
      const candidate = db.prepare(
        `SELECT action.* FROM autonomous_delivery_action action
         JOIN autonomous_delivery_run run ON run.id=action.run_id
         WHERE action.run_id=?
           AND ${activePredicate}
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
      return {
        action,
        attempt: db.prepare('SELECT * FROM autonomous_delivery_attempt WHERE id=?')
          .get(attemptId) as DeliveryAttemptRow,
      };
    })();
  }

  markAttemptRunning(attemptId: string, now: Date = new Date()): DeliveryAttemptRow | undefined {
    const timestamp = nowIso(now);
    const db = deliveryDb();
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
    return deliveryDb().prepare('SELECT * FROM autonomous_delivery_attempt WHERE id=?')
      .get(attemptId) as DeliveryAttemptRow | undefined;
  }

  heartbeat(attemptId: string, leaseMs: number, now: Date = new Date()): boolean {
    const timestamp = nowIso(now);
    const result = deliveryDb().prepare(
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
    const db = deliveryDb();
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
    deliveryDb().transaction(() => {
      this.appendReceipt({
        runId: input.runId,
        receipt: input.receipt,
        fallbackKey: `${input.runId}:${input.receipt.kind}:${input.receipt.externalId ?? 'observation'}`,
        now: timestamp,
      });
    })();
    return deliveryDb().prepare(
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
    const db = deliveryDb();
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
      return retry ? 'retry_wait' : 'failed';
    })();
  }

  abandonExpiredAttempts(now: Date = new Date()): number {
    const timestamp = nowIso(now);
    const db = deliveryDb();
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
    deliveryDb().prepare(
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
    return deliveryDb().prepare('SELECT * FROM autonomous_delivery_receipt WHERE idempotency_key=?')
      .get(idempotencyKey) as DeliveryReceiptRow;
  }
}

export const autonomousDeliveryRepo = new AutonomousDeliveryRepository();
