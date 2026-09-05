import type Database from 'better-sqlite3';
import type { ContextRequest } from '../../lib/agent-context/ContextManager';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import { getDb } from '../db';
import type {
  AgentActivationSource,
  AgentExecutionMode,
  AgentExecutionSubject,
  RuntimeAdmissionContext,
} from '../invocation-pipeline/types';
import type { CollaborationReplyAddress } from '../collaboration-kernel/types';
import { generateSortableId } from '../repositories/sortable-id';
import { parseWorkIdentity } from '../work-contract/work-identity';
import { PlatformEventLog } from './event-log';
import type { PlatformEvent } from './types';

export interface AgentWorkCommand {
  requestId?: string;
  laneId?: string;
  replyTo?: CollaborationReplyAddress;
  source: AgentActivationSource;
  prompt: string;
  correlationId?: string;
  causationId?: string;
  workId?: string;
  executionMode?: AgentExecutionMode;
  executionSubject?: AgentExecutionSubject;
  taskId?: string;
  deliveryRunId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  possessionId?: string;
  possessionRevision?: number;
  a2aHandoff?: ContextRequest['a2aHandoff'];
  contextScenario?: ContextScenario;
  legacyProposal?: boolean;
  wakeup?: ContextRequest['wakeup'];
  evaluation?: {
    executionId: string;
    caseId: string;
    applicationSnapshotId: string;
    targetManifestDigest: string;
  };
}

export type AgentInboxStatus =
  | 'enqueued'
  | 'claimed'
  | 'admitted'
  | 'released'
  | 'expired'
  | 'cancelled';

export interface AgentInboxItem {
  id: string;
  projectId: string;
  projectAgentId: string;
  sourceEventId?: string;
  idempotencyKey: string;
  command: AgentWorkCommand;
  status: AgentInboxStatus;
  attemptCount: number;
  runtimeStartFailureCount: number;
  availableAt: string;
  leaseToken?: string;
  leaseExpiresAt?: string;
  lastError?: string;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface AgentInboxRow {
  id: string;
  project_id: string;
  project_agent_id: string;
  source_event_id: string | null;
  idempotency_key: string;
  command_json: string;
  status: AgentInboxItem['status'];
  attempt_count: number;
  runtime_start_failure_count: number;
  available_at: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnqueueAgentWorkInput {
  projectId: string;
  projectAgentId: string;
  idempotencyKey: string;
  command: AgentWorkCommand;
  sourceEvent?: PlatformEvent;
}

export interface AgentInboxOptions {
  db?: Database.Database;
  eventLog?: PlatformEventLog;
  now?: () => Date;
  idFactory?: (prefix: 'inbox' | 'lease') => string;
  maxPendingPerRuntimeLane?: number;
}

function fromRow(row: AgentInboxRow): AgentInboxItem {
  return {
    id: row.id,
    projectId: row.project_id,
    projectAgentId: row.project_agent_id,
    ...(row.source_event_id ? { sourceEventId: row.source_event_id } : {}),
    idempotencyKey: row.idempotency_key,
    command: JSON.parse(row.command_json) as AgentWorkCommand,
    status: row.status,
    attemptCount: row.attempt_count,
    runtimeStartFailureCount: row.runtime_start_failure_count,
    availableAt: row.available_at,
    ...(row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: row.lease_expires_at } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.settled_at ? { settledAt: row.settled_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowCorrelationId(row: AgentInboxRow): string {
  const command = JSON.parse(row.command_json) as AgentWorkCommand;
  return command.correlationId?.trim() || `agent-work:${row.id}`;
}

function rowCausationId(row: AgentInboxRow): string | undefined {
  const command = JSON.parse(row.command_json) as AgentWorkCommand;
  return command.causationId?.trim() || row.source_event_id || undefined;
}

function rowCoordinationRefs(row: AgentInboxRow): Record<string, unknown> {
  const command = JSON.parse(row.command_json) as AgentWorkCommand;
  return {
    requestId: command.requestId,
    idempotencyKey: row.idempotency_key,
    laneId: command.laneId,
    replyTo: command.replyTo,
    workId: command.workId,
    executionSubject: command.executionSubject,
    taskId: command.taskId,
    deliveryRunId: command.deliveryRunId,
    chainId: command.chainId,
    passId: command.passId,
    possessionId: command.possessionId,
    commandSource: command.source,
    wakeup: command.wakeup,
    evaluation: command.evaluation,
  };
}

export class AgentInboxConflictError extends Error {
  readonly reasonCode = 'agent_inbox_idempotency_conflict';
}

export class AgentInboxCapacityError extends Error {
  readonly reasonCode = 'agent_inbox_lane_capacity_exceeded';
}

export class AgentInbox {
  private readonly database?: Database.Database;
  private readonly eventLog: PlatformEventLog;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'inbox' | 'lease') => string;
  private readonly maxPendingPerRuntimeLane: number;

  constructor(options: AgentInboxOptions = {}) {
    this.database = options.db;
    this.eventLog = options.eventLog ?? new PlatformEventLog({ db: options.db });
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
    this.maxPendingPerRuntimeLane = options.maxPendingPerRuntimeLane ?? 500;
    if (!Number.isInteger(this.maxPendingPerRuntimeLane) || this.maxPendingPerRuntimeLane < 1) {
      throw new Error('agent_inbox_capacity_invalid');
    }
  }

  enqueue(input: EnqueueAgentWorkInput): AgentInboxItem {
    const db = this.database ?? getDb();
    const command: AgentWorkCommand = {
      ...input.command,
      correlationId: input.command.correlationId
        ?? input.sourceEvent?.correlationId
        ?? `agent-work:${input.idempotencyKey}`,
      causationId: input.command.causationId
        ?? input.sourceEvent?.eventId,
    };
    const commandJson = JSON.stringify(command);
    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND project_agent_id=? AND idempotency_key=?
      `).get(
        input.projectId,
        input.projectAgentId,
        input.idempotencyKey,
      ) as AgentInboxRow | undefined;
      if (existing) {
        if (
          existing.project_id !== input.projectId
          || existing.project_agent_id !== input.projectAgentId
          || existing.source_event_id !== (input.sourceEvent?.eventId ?? null)
          || existing.command_json !== commandJson
        ) {
          throw new AgentInboxConflictError(input.idempotencyKey);
        }
        return fromRow(existing);
      }
      const pending = db.prepare(`
        SELECT COUNT(*) AS count FROM agent_inbox_item
        WHERE project_id=? AND project_agent_id=?
          AND status IN ('enqueued','released','claimed')
      `).get(input.projectId, input.projectAgentId) as { count: number };
      if (pending.count >= this.maxPendingPerRuntimeLane) {
        throw new AgentInboxCapacityError(
          `agent_inbox_lane_capacity_exceeded:${input.projectId}:${input.projectAgentId}`,
        );
      }
      const now = this.now().toISOString();
      const id = this.idFactory('inbox');
      db.prepare(`
        INSERT INTO agent_inbox_item (
          id,project_id,project_agent_id,source_event_id,idempotency_key,
          command_json,status,attempt_count,available_at,created_at,updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'enqueued', 0, ?, ?, ?)
      `).run(
        id,
        input.projectId,
        input.projectAgentId,
        input.sourceEvent?.eventId ?? null,
        input.idempotencyKey,
        commandJson,
        now,
        now,
        now,
      );
      this.appendCoordination('agent.work.enqueued', {
        id,
        projectId: input.projectId,
        projectAgentId: input.projectAgentId,
        correlationId: command.correlationId!,
        causationId: command.causationId,
        payload: {
          sourceEventId: input.sourceEvent?.eventId,
          idempotencyKey: input.idempotencyKey,
          commandSource: command.source,
          requestId: command.requestId,
          laneId: command.laneId,
          replyTo: command.replyTo,
          workId: command.workId,
          taskId: command.taskId,
          deliveryRunId: command.deliveryRunId,
          chainId: command.chainId,
          passId: command.passId,
          possessionId: command.possessionId,
          wakeup: command.wakeup,
        },
      });
      return this.get(id)!;
    }).immediate();
  }

  claimNext(leaseMs = 30_000): AgentInboxItem | undefined {
    const db = this.database ?? getDb();
    const nowDate = this.now();
    const now = nowDate.toISOString();
    return db.transaction(() => {
      const candidate = db.prepare(`
        SELECT candidate.* FROM agent_inbox_item candidate
        WHERE candidate.status IN ('enqueued','released') AND candidate.available_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM invocation active_invocation
            WHERE active_invocation.conversation_id=candidate.project_id
              AND active_invocation.agent_id=candidate.project_agent_id
              AND active_invocation.status<>'terminated'
              AND active_invocation.lease_expiry>?
          )
          AND NOT EXISTS (
            SELECT 1 FROM agent_inbox_item active
            WHERE active.project_id=candidate.project_id
              AND active.project_agent_id=candidate.project_agent_id
              AND active.status='claimed'
          )
          AND NOT EXISTS (
            SELECT 1 FROM agent_inbox_item predecessor
            WHERE predecessor.project_id=candidate.project_id
              AND predecessor.project_agent_id=candidate.project_agent_id
              AND predecessor.status IN ('enqueued','released','claimed')
              AND (
                predecessor.created_at < candidate.created_at
                OR (
                  predecessor.created_at = candidate.created_at
                  AND predecessor.id < candidate.id
                )
              )
          )
        ORDER BY candidate.available_at ASC, candidate.created_at ASC, candidate.id ASC
        LIMIT 1
      `).get(now, now) as AgentInboxRow | undefined;
      if (!candidate) return undefined;
      const leaseToken = this.idFactory('lease');
      const leaseExpiresAt = new Date(nowDate.getTime() + leaseMs).toISOString();
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status='claimed', attempt_count=attempt_count+1, lease_token=?,
            lease_expires_at=?, claimed_at=?, updated_at=?
        WHERE id=? AND status IN ('enqueued','released')
      `).run(leaseToken, leaseExpiresAt, now, now, candidate.id);
      if (result.changes !== 1) return undefined;
      this.appendCoordination('agent.work.claimed', {
        id: candidate.id,
        projectId: candidate.project_id,
        projectAgentId: candidate.project_agent_id,
        correlationId: rowCorrelationId(candidate),
        causationId: rowCausationId(candidate),
        dedupeNonce: leaseToken,
        payload: { ...rowCoordinationRefs(candidate), attemptCount: candidate.attempt_count + 1 },
      });
      return this.get(candidate.id);
    }).immediate();
  }

  releaseExpiredClaims(maxAttempts = 10): number {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      let recovered = 0;
      const expired = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE status='claimed' AND lease_expires_at <= ?
      `).all(now) as AgentInboxRow[];
      for (const item of expired) {
        const exhausted = item.attempt_count >= maxAttempts;
        const result = db.prepare(`
          UPDATE agent_inbox_item
          SET status=?, available_at=?, lease_token=NULL, lease_expires_at=NULL,
              last_error=?, settled_at=?, updated_at=?
          WHERE id=? AND status='claimed' AND lease_token=?
        `).run(
          exhausted ? 'expired' : 'released',
          now,
          exhausted ? 'lease_expired_retry_exhausted' : null,
          exhausted ? now : null,
          now,
          item.id,
          item.lease_token,
        );
        if (result.changes !== 1) continue;
        recovered += 1;
        this.appendCoordination(exhausted ? 'agent.work.expired' : 'agent.work.released', {
          id: item.id,
          projectId: item.project_id,
          projectAgentId: item.project_agent_id,
          correlationId: rowCorrelationId(item),
          causationId: rowCausationId(item),
          payload: {
            ...rowCoordinationRefs(item),
            reasonCode: exhausted ? 'lease_expired_retry_exhausted' : 'lease_expired',
            attemptCount: item.attempt_count,
          },
        });
      }
      return recovered;
    }).immediate();
  }

  renew(itemId: string, leaseToken: string, leaseMs = 30_000): boolean {
    const nowDate = this.now();
    const leaseExpiresAt = new Date(nowDate.getTime() + leaseMs).toISOString();
    const result = (this.database ?? getDb()).prepare(`
      UPDATE agent_inbox_item
      SET lease_expires_at=?, updated_at=?
      WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
    `).run(leaseExpiresAt, nowDate.toISOString(), itemId, leaseToken, nowDate.toISOString());
    return result.changes === 1;
  }

  release(
    itemId: string,
    leaseToken: string,
    delayMs: number,
    reasonCode: string,
    countRuntimeStartFailure = false,
  ): boolean {
    const db = this.database ?? getDb();
    const nowDate = this.now();
    const now = nowDate.toISOString();
    return db.transaction(() => {
      const item = db.prepare('SELECT * FROM agent_inbox_item WHERE id=?')
        .get(itemId) as AgentInboxRow | undefined;
      if (!item || item.status !== 'claimed' || item.lease_token !== leaseToken) return false;
      const availableAt = new Date(nowDate.getTime() + delayMs).toISOString();
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status='released', available_at=?, lease_token=NULL, lease_expires_at=NULL,
            last_error=?, updated_at=?,
            runtime_start_failure_count=runtime_start_failure_count+?
        WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
      `).run(
        availableAt,
        reasonCode,
        now,
        countRuntimeStartFailure ? 1 : 0,
        itemId,
        leaseToken,
        now,
      );
      if (result.changes !== 1) return false;
      this.appendCoordination('agent.work.released', {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: { ...rowCoordinationRefs(item), reasonCode, attemptCount: item.attempt_count },
      });
      return true;
    }).immediate();
  }

  admit(itemId: string, leaseToken: string): boolean {
    return this.settleClaim(itemId, leaseToken, 'admitted');
  }

  /** Atomically fences the Inbox claim and the directed Envelope ACK. */
  admitWithClaimFence(
    itemId: string,
    leaseToken: string,
    acknowledgeEnvelope: () => boolean,
    runtimeAdmission: RuntimeAdmissionContext,
  ): boolean {
    const db = this.database ?? getDb();
    try {
      return db.transaction(() => {
        if (!this.ownsClaim(itemId, leaseToken)) return false;
        const now = this.now().toISOString();
        const ownsRuntime = db.prepare(`
          SELECT 1 FROM invocation
          WHERE id=? AND status<>'terminated' AND runtime_owner_token=? AND lease_expiry>?
        `).get(runtimeAdmission.invocationId, leaseToken, now);
        if (!ownsRuntime) return false;
        if (!acknowledgeEnvelope()) return false;
        if (!this.settleClaim(
          itemId,
          leaseToken,
          'admitted',
          undefined,
          false,
          { runtimeAdmission },
        )) {
          throw new Error('agent_inbox_claim_lost_during_runtime_ack');
        }
        return true;
      }).immediate();
    } catch (error) {
      if (
        error instanceof Error
        && error.message === 'agent_inbox_claim_lost_during_runtime_ack'
      ) return false;
      throw error;
    }
  }

  expire(
    itemId: string,
    leaseToken: string,
    reasonCode: string,
    countRuntimeStartFailure = false,
  ): boolean {
    return this.settleClaim(
      itemId,
      leaseToken,
      'expired',
      reasonCode,
      countRuntimeStartFailure,
    );
  }

  get(id: string): AgentInboxItem | undefined {
    const row = (this.database ?? getDb()).prepare('SELECT * FROM agent_inbox_item WHERE id=?')
      .get(id) as AgentInboxRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  getByIdempotencyKey(
    projectId: string,
    projectAgentId: string,
    idempotencyKey: string,
  ): AgentInboxItem | undefined {
    const row = (this.database ?? getDb()).prepare(
      `SELECT * FROM agent_inbox_item
       WHERE project_id=? AND project_agent_id=? AND idempotency_key=?`,
    ).get(projectId, projectAgentId, idempotencyKey) as AgentInboxRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  listPending(projectId?: string): AgentInboxItem[] {
    const db = this.database ?? getDb();
    const rows = projectId
      ? db.prepare(`
          SELECT * FROM agent_inbox_item
          WHERE project_id=? AND status IN ('enqueued','released','claimed')
          ORDER BY created_at ASC, id ASC
        `).all(projectId)
      : db.prepare(`
          SELECT * FROM agent_inbox_item
          WHERE status IN ('enqueued','released','claimed')
          ORDER BY created_at ASC, id ASC
        `).all();
    return (rows as AgentInboxRow[]).map(fromRow);
  }

  listExpired(projectId?: string): AgentInboxItem[] {
    const db = this.database ?? getDb();
    const rows = projectId
      ? db.prepare(`
          SELECT * FROM agent_inbox_item
          WHERE project_id=? AND status='expired'
          ORDER BY settled_at DESC, id DESC
        `).all(projectId)
      : db.prepare(`
          SELECT * FROM agent_inbox_item
          WHERE status='expired'
          ORDER BY settled_at DESC, id DESC
        `).all();
    return (rows as AgentInboxRow[]).map(fromRow);
  }

  retryExpired(itemId: string): AgentInboxItem | undefined {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const row = db.prepare(`SELECT * FROM agent_inbox_item WHERE id=? AND status='expired'`)
        .get(itemId) as AgentInboxRow | undefined;
      if (!row) return undefined;
      const now = this.now().toISOString();
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status='released', attempt_count=0, runtime_start_failure_count=0,
            available_at=?, lease_token=NULL, lease_expires_at=NULL,
            last_error=NULL, settled_at=NULL, updated_at=?
        WHERE id=? AND status='expired'
      `).run(now, now, itemId);
      if (result.changes !== 1) return undefined;
      this.appendCoordination('agent.work.released', {
        id: row.id,
        projectId: row.project_id,
        projectAgentId: row.project_agent_id,
        correlationId: rowCorrelationId(row),
        causationId: rowCausationId(row),
        payload: { ...rowCoordinationRefs(row), reasonCode: 'manual_retry', attemptCount: row.attempt_count },
      });
      return this.get(itemId);
    }).immediate();
  }

  getReissuedReplacement(itemId: string): AgentInboxItem | undefined {
    const db = this.database ?? getDb();
    const row = db.prepare(`
      SELECT replacement.*
      FROM platform_event AS event
      JOIN agent_inbox_item AS replacement
        ON replacement.id=json_extract(event.payload,'$.replacementInboxItemId')
      WHERE event.type='agent.work.cancelled'
        AND event.aggregate_type='agent_inbox_item'
        AND event.aggregate_id=?
        AND json_extract(event.payload,'$.reasonCode')='manual_retry_reissued'
      ORDER BY event.stream_sequence DESC,event.id DESC
      LIMIT 1
    `).get(itemId) as AgentInboxRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  markExpiredReissued(itemId: string, replacementInboxItemId: string): boolean {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const row = db.prepare(`SELECT * FROM agent_inbox_item WHERE id=? AND status='expired'`)
        .get(itemId) as AgentInboxRow | undefined;
      if (!row) return false;
      const replacementId = replacementInboxItemId.trim();
      if (!replacementId) throw new Error('replacement_inbox_item_required');
      const now = this.now().toISOString();
      const released = db.prepare(`
        UPDATE agent_inbox_item
        SET status='released',attempt_count=0,runtime_start_failure_count=0,
            available_at=?,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,
            settled_at=NULL,updated_at=?
        WHERE id=? AND status='expired'
      `).run(now, now, itemId);
      if (released.changes !== 1) return false;
      const cancelled = db.prepare(`
        UPDATE agent_inbox_item
        SET status='cancelled',last_error='manual_retry_reissued',settled_at=?,updated_at=?
        WHERE id=? AND status='released'
      `).run(now, now, itemId);
      if (cancelled.changes !== 1) throw new Error('expired_inbox_reissue_settlement_failed');
      this.appendCoordination('agent.work.cancelled', {
        id: row.id,
        projectId: row.project_id,
        projectAgentId: row.project_agent_id,
        correlationId: rowCorrelationId(row),
        causationId: rowCausationId(row),
        payload: {
          ...rowCoordinationRefs(row),
          reasonCode: 'manual_retry_reissued',
          replacementInboxItemId: replacementId,
        },
      });
      return true;
    }).immediate();
  }

  cancelPending(
    projectId: string,
    projectAgentId: string,
    idempotencyKey?: string,
    reasonCode = 'user_cancelled',
  ): number {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = (idempotencyKey
        ? db.prepare(`
            SELECT * FROM agent_inbox_item
            WHERE project_id=? AND project_agent_id=? AND idempotency_key=?
              AND status IN ('enqueued','released')
          `).all(projectId, projectAgentId, idempotencyKey)
        : db.prepare(`
            SELECT * FROM agent_inbox_item
            WHERE project_id=? AND project_agent_id=? AND status IN ('enqueued','released')
          `).all(projectId, projectAgentId)) as AgentInboxRow[];
      return this.cancelRows(rows, reasonCode);
    }).immediate();
  }

  cancelPendingForTask(projectId: string, taskId: string): number {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = (db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND status IN ('enqueued','released')
          AND json_extract(command_json, '$.taskId')=?
      `).all(projectId, taskId) as AgentInboxRow[]).filter((row) => {
        const command = JSON.parse(row.command_json) as AgentWorkCommand;
        const identity = parseWorkIdentity(command.workId);
        return !(
          identity?.scope === 'delivery'
          && (identity.purpose === 'review' || identity.purpose === 'verify')
        );
      });
      return this.cancelRows(rows, 'task_terminal');
    }).immediate();
  }

  ownsClaim(itemId: string, leaseToken: string): boolean {
    const now = this.now().toISOString();
    const row = (this.database ?? getDb()).prepare(`
      SELECT 1 FROM agent_inbox_item
      WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
    `).get(itemId, leaseToken, now);
    return Boolean(row);
  }

  cancelPendingForChain(projectId: string, chainId: string): number {
    const rows = (this.database ?? getDb()).prepare(`
      SELECT project_agent_id,idempotency_key
      FROM agent_inbox_item
      WHERE project_id=? AND status IN ('enqueued','released')
        AND json_extract(command_json,'$.chainId')=?
    `).all(projectId, chainId) as Array<{
      project_agent_id: string;
      idempotency_key: string;
    }>;
    let cancelled = 0;
    for (const row of rows) {
      cancelled += this.cancelPending(projectId, row.project_agent_id, row.idempotency_key);
    }
    return cancelled;
  }

  cancelPendingForWorkIds(
    projectId: string,
    workIds: readonly string[],
    reasonCode = 'work_owner_terminal',
  ): number {
    const targets = new Set(workIds.map((workId) => workId.trim()).filter(Boolean));
    if (targets.size === 0) return 0;
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND status IN ('enqueued','released','claimed')
      `).all(projectId) as AgentInboxRow[];
      return this.cancelRows(rows.filter((row) => {
        const command = JSON.parse(row.command_json) as AgentWorkCommand;
        return typeof command.workId === 'string' && targets.has(command.workId);
      }), reasonCode, true);
    }).immediate();
  }

  cancelForTerminalTask(projectId: string, taskId: string): number {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND status IN ('enqueued','released','claimed')
          AND json_extract(command_json, '$.taskId')=?
      `).all(projectId, taskId) as AgentInboxRow[];
      return this.cancelRows(rows.filter((row) => {
        const command = JSON.parse(row.command_json) as AgentWorkCommand;
        const identity = parseWorkIdentity(command.workId);
        const deliveryGateWithoutIdentity = !identity
          && Boolean(command.deliveryRunId)
          && (command.source === 'review_gate' || command.source === 'test_gate');
        return identity?.scope !== 'delivery' && !deliveryGateWithoutIdentity;
      }), 'task_owner_terminal', true);
    }).immediate();
  }

  cancelForTerminalDelivery(projectId: string, deliveryRunId: string): number {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND status IN ('enqueued','released','claimed')
      `).all(projectId) as AgentInboxRow[];
      return this.cancelRows(rows.filter((row) => {
        const command = JSON.parse(row.command_json) as AgentWorkCommand;
        const identity = parseWorkIdentity(command.workId);
        return command.deliveryRunId === deliveryRunId
          || (identity?.scope === 'delivery' && identity.targetId === deliveryRunId);
      }), 'delivery_owner_terminal', true);
    }).immediate();
  }

  private settleClaim(
    itemId: string,
    leaseToken: string,
    status: 'admitted' | 'expired',
    error?: string,
    countRuntimeStartFailure = false,
    extraPayload: Record<string, unknown> = {},
  ): boolean {
    const now = this.now().toISOString();
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const item = db.prepare('SELECT * FROM agent_inbox_item WHERE id=?')
        .get(itemId) as AgentInboxRow | undefined;
      if (
        !item
        || item.status !== 'claimed'
        || item.lease_token !== leaseToken
        || !item.lease_expires_at
        || item.lease_expires_at <= now
      ) return false;
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status=?, lease_token=NULL, lease_expires_at=NULL, last_error=?,
            updated_at=?, settled_at=?,
            runtime_start_failure_count=runtime_start_failure_count+?
        WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
      `).run(
        status,
        error ?? null,
        now,
        now,
        countRuntimeStartFailure ? 1 : 0,
        itemId,
        leaseToken,
        now,
      );
      if (result.changes !== 1) return false;
      this.appendCoordination(`agent.work.${status}`, {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: {
          ...rowCoordinationRefs(item),
          attemptCount: item.attempt_count,
          ...(error ? { reasonCode: error } : {}),
          ...extraPayload,
        },
      });
      return true;
    }).immediate();
  }

  private cancelRows(
    rows: AgentInboxRow[],
    reasonCode: string,
    includeClaimed = false,
  ): number {
    if (rows.length === 0) return 0;
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    let cancelled = 0;
    for (const item of rows) {
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status='cancelled', lease_token=NULL, lease_expires_at=NULL,
            last_error=?, updated_at=?, settled_at=?
        WHERE id=? AND status IN (${includeClaimed
          ? "'enqueued','released','claimed'"
          : "'enqueued','released'"})
      `).run(reasonCode, now, now, item.id);
      if (result.changes !== 1) continue;
      cancelled += 1;
      this.appendCoordination('agent.work.cancelled', {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: { ...rowCoordinationRefs(item), reasonCode },
      });
    }
    return cancelled;
  }

  private appendCoordination(
    type:
      | 'agent.work.enqueued'
      | 'agent.work.claimed'
      | 'agent.work.released'
      | 'agent.work.admitted'
      | 'agent.work.expired'
      | 'agent.work.cancelled',
    input: {
      id: string;
      projectId: string;
      projectAgentId: string;
      correlationId: string;
      causationId?: string;
      dedupeNonce?: string;
      payload: Record<string, unknown>;
    },
  ): void {
    this.eventLog.append({
      type,
      category: 'coordination',
      projectId: input.projectId,
      streamKey: `agent-work:${input.projectId}:${input.projectAgentId}`,
      aggregate: { type: 'agent_inbox_item', id: input.id },
      actor: { type: 'system', id: 'agent-inbox' },
      subject: { type: 'project_agent', id: input.projectAgentId },
      projectAgentId: input.projectAgentId,
      inboxItemId: input.id,
      correlationId: input.correlationId,
      causationId: input.causationId,
      dedupeKey: `coordination:${input.id}:${type}:${input.dedupeNonce ?? JSON.stringify(input.payload)}`,
      payload: input.payload,
    });
  }
}
