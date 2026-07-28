import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import { PlatformEventLog } from '../platform-events/event-log';
import type { ControlAction, ControlDecision } from './control-decision';
import { resolveGoalCorrelationId, type GoalContract } from './types';

export type PersistedControlActionStatus =
  | 'ready'
  | 'claimed'
  | 'applied'
  | 'failed'
  | 'cancelled';

export interface PersistedControlDecisionRow {
  id: string;
  run_id: string;
  project_id: string;
  snapshot_revision: number;
  policy_revision: number;
  payload_json: string;
  status: 'active' | 'superseded' | 'completed';
  created_at: string;
  completed_at: string | null;
}

export interface PersistedControlActionRow {
  id: string;
  decision_id: string;
  run_id: string;
  type: ControlAction['type'];
  target_work_id: string | null;
  work_epoch: number | null;
  slot_id: string | null;
  reason_code: string;
  retry_budget_kind: ControlAction['retryBudgetKind'] | null;
  termination_outcome: ControlAction['terminationOutcome'] | null;
  status: PersistedControlActionStatus;
  claim_token: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt_count: number;
  max_attempts: number;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export class StaleControlSnapshotError extends Error {
  readonly reasonCode = 'stale_control_snapshot';

  constructor(readonly expected: number, readonly actual: number) {
    super(`Control snapshot is stale: expected ${expected}, actual ${actual}`);
  }
}

export class ControlDecisionConflictError extends Error {
  readonly reasonCode = 'control_decision_conflict';
}

export class ControlActionClaimError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
  }
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export class ControlDecisionRepository {
  constructor(private readonly database?: Database.Database) {}

  projectSnapshotRevision(projectId: string): number {
    const row = (this.database ?? getDb()).prepare(`
      SELECT COALESCE(MAX(ingestion.ingestion_id),0) AS revision
      FROM platform_event_ingestion ingestion
      JOIN platform_event event ON event.id=ingestion.event_id
      WHERE event.project_id=?
    `).get(projectId) as { revision: number };
    return row.revision;
  }

  persist(input: {
    projectId: string;
    decision: ControlDecision;
    now?: Date;
  }): PersistedControlDecisionRow {
    const db = this.database ?? getDb();
    const payload = canonicalJson(input.decision);
    const timestamp = (input.now ?? new Date()).toISOString();
    return db.transaction(() => {
      const duplicate = db.prepare('SELECT * FROM delivery_control_decision WHERE id=?')
        .get(input.decision.decisionId) as PersistedControlDecisionRow | undefined;
      if (duplicate) {
        if (
          duplicate.run_id !== input.decision.runId
          || duplicate.project_id !== input.projectId
          || duplicate.snapshot_revision !== input.decision.snapshotRevision
          || duplicate.policy_revision !== input.decision.policyRevision
          || duplicate.payload_json !== payload
        ) throw new ControlDecisionConflictError('Decision identity is bound to different content');
        return duplicate;
      }
      const actualRevision = this.projectSnapshotRevision(input.projectId);
      if (actualRevision !== input.decision.snapshotRevision) {
        throw new StaleControlSnapshotError(input.decision.snapshotRevision, actualRevision);
      }

      db.prepare(`
        UPDATE delivery_control_decision
        SET status='superseded',completed_at=?
        WHERE run_id=? AND status='active'
      `).run(timestamp, input.decision.runId);
      db.prepare(`
        UPDATE delivery_control_action
        SET status='cancelled',failure_code='decision_superseded',updated_at=?,completed_at=?
        WHERE run_id=? AND status='ready'
      `).run(timestamp, timestamp, input.decision.runId);
      db.prepare(`
        INSERT INTO delivery_control_decision (
          id,run_id,project_id,snapshot_revision,policy_revision,payload_json,
          status,created_at,completed_at
        ) VALUES (?,?,?,?,?,?,'active',?,NULL)
      `).run(
        input.decision.decisionId,
        input.decision.runId,
        input.projectId,
        input.decision.snapshotRevision,
        input.decision.policyRevision,
        payload,
        timestamp,
      );
      for (const action of input.decision.actions) {
        if (action.type === 'wait') continue;
        db.prepare(`
          INSERT INTO delivery_control_action (
            id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
            retry_budget_kind,termination_outcome,status,claim_token,lease_owner,
            lease_expires_at,failure_code,created_at,updated_at,completed_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,'ready',NULL,NULL,NULL,NULL,?,?,NULL)
        `).run(
          action.actionId,
          input.decision.decisionId,
          input.decision.runId,
          action.type,
          action.targetWorkId ?? null,
          action.workEpoch ?? null,
          action.slotId ?? null,
          action.reasonCode,
          action.retryBudgetKind ?? null,
          action.terminationOutcome ?? null,
          timestamp,
          timestamp,
        );
      }
      return db.prepare('SELECT * FROM delivery_control_decision WHERE id=?')
        .get(input.decision.decisionId) as PersistedControlDecisionRow;
    }).immediate();
  }

  claim(input: {
    actionId: string;
    workerId: string;
    leaseMs: number;
    now?: Date;
  }): PersistedControlActionRow {
    const db = this.database ?? getDb();
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    return db.transaction(() => {
      const action = db.prepare(`
        SELECT action.*,decision.project_id,decision.snapshot_revision,decision.status AS decision_status
        FROM delivery_control_action action
        JOIN delivery_control_decision decision ON decision.id=action.decision_id
        WHERE action.id=?
      `).get(input.actionId) as (PersistedControlActionRow & {
        project_id: string;
        snapshot_revision: number;
        decision_status: string;
      }) | undefined;
      if (!action) throw new ControlActionClaimError('control_action_missing', input.actionId);
      if (
        action.status !== 'ready'
        || action.decision_status !== 'active'
        || action.attempt_count >= action.max_attempts
      ) {
        throw new ControlActionClaimError('control_action_not_claimable', input.actionId);
      }
      const actualRevision = this.projectSnapshotRevision(action.project_id);
      if (actualRevision !== action.snapshot_revision) {
        throw new StaleControlSnapshotError(action.snapshot_revision, actualRevision);
      }
      if (action.target_work_id !== null) {
        const authority = db.prepare(`
          SELECT current_epoch,status FROM work_authority WHERE work_id=?
        `).get(action.target_work_id) as { current_epoch: number; status: string } | undefined;
        const validUnissuedWork = action.work_epoch === 0 && !authority;
        const validIssuedWork = Boolean(
          authority
          && authority.status === 'active'
          && authority.current_epoch === action.work_epoch,
        );
        if (!validUnissuedWork && !validIssuedWork) {
          throw new ControlActionClaimError(
            'stale_work_epoch',
            `Work authority changed for ${action.target_work_id}`,
          );
        }
      }
      if (action.slot_id) {
        const occupied = db.prepare(`
          SELECT id FROM delivery_control_action
          WHERE id<>? AND run_id=? AND slot_id=?
            AND type IN ('activate','retry') AND status IN ('claimed','applied')
          LIMIT 1
        `).get(action.id, action.run_id, action.slot_id);
        if (occupied) {
          throw new ControlActionClaimError(
            'control_slot_occupied',
            `Control slot is already reserved: ${action.slot_id}`,
          );
        }
      }
      const claimToken = generateSortableId('control-claim');
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
      const claimed = db.prepare(`
        UPDATE delivery_control_action
        SET status='claimed',claim_token=?,lease_owner=?,lease_expires_at=?,
            attempt_count=attempt_count+1,updated_at=?
        WHERE id=? AND status='ready' AND attempt_count<max_attempts
      `).run(claimToken, input.workerId, leaseExpiresAt, timestamp, action.id);
      if (claimed.changes !== 1) {
        throw new ControlActionClaimError('control_action_claim_raced', action.id);
      }
      return db.prepare('SELECT * FROM delivery_control_action WHERE id=?')
        .get(action.id) as PersistedControlActionRow;
    }).immediate();
  }

  claimDecision(input: {
    decisionId: string;
    workerId: string;
    leaseMs: number;
    now?: Date;
  }): PersistedControlActionRow[] {
    const db = this.database ?? getDb();
    const now = input.now ?? new Date();
    const timestamp = now.toISOString();
    return db.transaction(() => {
      const decision = db.prepare(`
        SELECT * FROM delivery_control_decision WHERE id=?
      `).get(input.decisionId) as PersistedControlDecisionRow | undefined;
      if (!decision || decision.status !== 'active') {
        throw new ControlActionClaimError('control_decision_not_claimable', input.decisionId);
      }
      const actualRevision = this.projectSnapshotRevision(decision.project_id);
      if (actualRevision !== decision.snapshot_revision) {
        throw new StaleControlSnapshotError(decision.snapshot_revision, actualRevision);
      }
      const actions = db.prepare(`
        SELECT * FROM delivery_control_action
        WHERE decision_id=? AND status='ready' AND attempt_count<max_attempts
        ORDER BY created_at,id
      `).all(input.decisionId) as PersistedControlActionRow[];
      const batchSlots = new Set<string>();
      for (const action of actions) {
        if (action.target_work_id !== null) {
          const authority = db.prepare(`
            SELECT current_epoch,status FROM work_authority WHERE work_id=?
          `).get(action.target_work_id) as { current_epoch: number; status: string } | undefined;
          const validUnissuedWork = action.work_epoch === 0 && !authority;
          const validIssuedWork = Boolean(
            authority
            && authority.status === 'active'
            && authority.current_epoch === action.work_epoch,
          );
          if (!validUnissuedWork && !validIssuedWork) {
            throw new ControlActionClaimError(
              'stale_work_epoch',
              `Work authority changed for ${action.target_work_id}`,
            );
          }
        }
        if (!action.slot_id) continue;
        if (batchSlots.has(action.slot_id)) {
          throw new ControlActionClaimError(
            'control_slot_duplicated',
            `Decision assigns a slot more than once: ${action.slot_id}`,
          );
        }
        batchSlots.add(action.slot_id);
        const occupied = db.prepare(`
          SELECT id FROM delivery_control_action
          WHERE decision_id<>? AND run_id=? AND slot_id=?
            AND type IN ('activate','retry') AND status IN ('claimed','applied')
          LIMIT 1
        `).get(input.decisionId, action.run_id, action.slot_id);
        if (occupied) {
          throw new ControlActionClaimError(
            'control_slot_occupied',
            `Control slot is already reserved: ${action.slot_id}`,
          );
        }
      }

      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
      for (const action of actions) {
        const claimed = db.prepare(`
          UPDATE delivery_control_action
          SET status='claimed',claim_token=?,lease_owner=?,lease_expires_at=?,
              attempt_count=attempt_count+1,updated_at=?
          WHERE id=? AND status='ready' AND attempt_count<max_attempts
        `).run(
          generateSortableId('control-claim'),
          input.workerId,
          leaseExpiresAt,
          timestamp,
          action.id,
        );
        if (claimed.changes !== 1) {
          throw new ControlActionClaimError('control_action_claim_raced', action.id);
        }
      }
      return db.prepare(`
        SELECT * FROM delivery_control_action
        WHERE decision_id=? AND status='claimed' AND lease_owner=?
        ORDER BY created_at,id
      `).all(input.decisionId, input.workerId) as PersistedControlActionRow[];
    }).immediate();
  }

  complete(input: {
    actionId: string;
    claimToken: string;
    now?: Date;
  }): boolean {
    const timestamp = (input.now ?? new Date()).toISOString();
    const result = (this.database ?? getDb()).prepare(`
      UPDATE delivery_control_action
      SET status='applied',claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
          updated_at=?,completed_at=?
      WHERE id=? AND status='claimed' AND claim_token=? AND lease_expires_at>?
    `).run(timestamp, timestamp, input.actionId, input.claimToken, timestamp);
    return result.changes === 1;
  }

  isClaimActive(input: { actionId: string; claimToken: string; now?: Date }): boolean {
    const timestamp = (input.now ?? new Date()).toISOString();
    return Boolean((this.database ?? getDb()).prepare(`
      SELECT 1 FROM delivery_control_action
      WHERE id=? AND status='claimed' AND claim_token=? AND lease_expires_at>?
    `).get(input.actionId, input.claimToken, timestamp));
  }

  fail(input: {
    actionId: string;
    claimToken: string;
    reasonCode: string;
    now?: Date;
  }): boolean {
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const action = db.prepare(`
        SELECT action.*,decision.project_id
        FROM delivery_control_action action
        JOIN delivery_control_decision decision ON decision.id=action.decision_id
        WHERE action.id=? AND action.status='claimed' AND action.claim_token=?
          AND action.lease_expires_at>?
      `).get(input.actionId, input.claimToken, timestamp) as (
        PersistedControlActionRow & { project_id: string }
      ) | undefined;
      if (!action) return false;
      const exhausted = action.attempt_count >= action.max_attempts;
      const result = db.prepare(`
        UPDATE delivery_control_action
        SET status=?,failure_code=?,claim_token=NULL,lease_owner=NULL,
            lease_expires_at=NULL,updated_at=?,completed_at=?
        WHERE id=? AND status='claimed' AND claim_token=? AND lease_expires_at>?
      `).run(
        exhausted ? 'failed' : 'ready',
        input.reasonCode,
        timestamp,
        exhausted ? timestamp : null,
        input.actionId,
        input.claimToken,
        timestamp,
      );
      if (result.changes !== 1) return false;
      if (exhausted) {
        this.publishTerminalFailure(db, action, input.reasonCode, timestamp);
      }
      return true;
    }).immediate();
  }

  releaseSlot(input: {
    actionId: string;
    reasonCode: string;
    now?: Date;
  }): boolean {
    const timestamp = (input.now ?? new Date()).toISOString();
    const result = (this.database ?? getDb()).prepare(`
      UPDATE delivery_control_action
      SET status='cancelled',failure_code=?,updated_at=?,completed_at=?
      WHERE id=? AND type IN ('activate','retry') AND status='applied'
    `).run(input.reasonCode, timestamp, timestamp, input.actionId);
    return result.changes === 1;
  }

  releaseSlotsForWork(input: {
    workId: string;
    reasonCode: string;
    now?: Date;
  }): number {
    const timestamp = (input.now ?? new Date()).toISOString();
    return (this.database ?? getDb()).prepare(`
      UPDATE delivery_control_action
      SET status='cancelled',failure_code=?,updated_at=?,completed_at=?
      WHERE target_work_id=? AND type IN ('activate','retry') AND status='applied'
    `).run(
      input.reasonCode,
      timestamp,
      timestamp,
      input.workId,
    ).changes;
  }

  recoverExpired(now: Date = new Date()): number {
    const timestamp = now.toISOString();
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const expired = db.prepare(`
        SELECT action.*,decision.project_id
        FROM delivery_control_action action
        JOIN delivery_control_decision decision ON decision.id=action.decision_id
        WHERE action.status='claimed' AND action.lease_expires_at<?
      `).all(timestamp) as Array<PersistedControlActionRow & { project_id: string }>;
      let recovered = 0;
      for (const action of expired) {
        const exhausted = action.attempt_count >= action.max_attempts;
        const updated = db.prepare(`
          UPDATE delivery_control_action
          SET status=?,claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,
              failure_code='claim_lease_expired',updated_at=?,completed_at=?
          WHERE id=? AND status='claimed' AND claim_token=?
        `).run(
          exhausted ? 'failed' : 'ready',
          timestamp,
          exhausted ? timestamp : null,
          action.id,
          action.claim_token,
        );
        if (updated.changes !== 1) continue;
        recovered += 1;
        if (exhausted) {
          this.publishTerminalFailure(db, action, 'claim_lease_expired', timestamp);
        }
      }
      return recovered;
    }).immediate();
  }

  listActions(decisionId: string): PersistedControlActionRow[] {
    return (this.database ?? getDb()).prepare(`
      SELECT * FROM delivery_control_action WHERE decision_id=? ORDER BY created_at,id
    `).all(decisionId) as PersistedControlActionRow[];
  }

  private publishTerminalFailure(
    db: Database.Database,
    action: PersistedControlActionRow & { project_id: string },
    reasonCode: string,
    occurredAt: string,
  ): void {
    const run = db.prepare(`
      SELECT goal_contract_json FROM autonomous_delivery_run WHERE id=?
    `).get(action.run_id) as { goal_contract_json: string } | undefined;
    const correlationId = run
      ? resolveGoalCorrelationId(JSON.parse(run.goal_contract_json) as GoalContract)
      : `delivery-run:${action.run_id}`;
    new PlatformEventLog({ db }).append({
      type: 'control.action.failed',
      category: 'coordination',
      projectId: action.project_id,
      streamKey: `control-action:${action.id}`,
      aggregate: {
        type: 'control_action',
        id: action.id,
        version: action.attempt_count,
      },
      actor: { type: 'system', id: 'delivery-control-process-manager' },
      subject: action.target_work_id
        ? { type: 'work', id: action.target_work_id }
        : { type: 'delivery_run', id: action.run_id },
      correlationId,
      causationId: action.id,
      dedupeKey: `control-action:${action.id}:failed:${action.attempt_count}`,
      occurredAt,
      payload: {
        actionId: action.id,
        actionType: action.type,
        runId: action.run_id,
        targetWorkId: action.target_work_id,
        reasonCode,
        attemptsUsed: action.attempt_count,
        maxAttempts: action.max_attempts,
      },
    });
  }
}
