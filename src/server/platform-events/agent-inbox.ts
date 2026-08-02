import type Database from 'better-sqlite3';
import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import { getDb } from '../db';
import type { AgentActivationSource } from '../invocation-pipeline/types';
import { generateSortableId } from '../repositories/sortable-id';
import { PlatformEventLog } from './event-log';
import type { PlatformEvent } from './types';

export interface AgentWorkCommand {
  source: AgentActivationSource;
  prompt: string;
  correlationId?: string;
  causationId?: string;
  workId?: string;
  taskId?: string;
  deliveryRunId?: string;
  fromAgentId?: string;
  chainId?: string;
  passId?: string;
  contextScenario?: ContextScenario;
  legacyProposal?: boolean;
}

export const AGENT_INBOX_STATUSES = [
  'enqueued',
  'claimed',
  'admitted',
  'released',
  'expired',
  'cancelled',
] as const;

export type AgentInboxStatus = (typeof AGENT_INBOX_STATUSES)[number];

export interface AgentInboxItem {
  id: string;
  projectId: string;
  projectAgentId: string;
  sourceEventId?: string;
  idempotencyKey: string;
  command: AgentWorkCommand;
  status: AgentInboxStatus;
  attemptCount: number;
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

export class AgentInboxConflictError extends Error {
  readonly reasonCode = 'agent_inbox_idempotency_conflict';
}

export class AgentInbox {
  private readonly database?: Database.Database;
  private readonly eventLog: PlatformEventLog;
  private readonly now: () => Date;
  private readonly idFactory: (prefix: 'inbox' | 'lease') => string;

  constructor(options: AgentInboxOptions = {}) {
    this.database = options.db;
    this.eventLog = options.eventLog ?? new PlatformEventLog({ db: options.db });
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
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
        SELECT * FROM agent_inbox_item WHERE idempotency_key=?
      `).get(input.idempotencyKey) as AgentInboxRow | undefined;
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
        payload: { sourceEventId: input.sourceEvent?.eventId, commandSource: command.source },
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
      `).get(now) as AgentInboxRow | undefined;
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
        payload: { attemptCount: candidate.attempt_count + 1 },
      });
      return this.get(candidate.id);
    }).immediate();
  }

  releaseExpiredClaims(): number {
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    return db.transaction(() => {
      let recovered = 0;
      const expired = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE status='claimed' AND lease_expires_at <= ?
      `).all(now) as AgentInboxRow[];
      for (const item of expired) {
        const result = db.prepare(`
          UPDATE agent_inbox_item
          SET status='released', available_at=?, lease_token=NULL, lease_expires_at=NULL,
              updated_at=?
          WHERE id=? AND status='claimed' AND lease_token=?
        `).run(now, now, item.id, item.lease_token);
        if (result.changes !== 1) continue;
        recovered += 1;
        this.appendCoordination('agent.work.released', {
          id: item.id,
          projectId: item.project_id,
          projectAgentId: item.project_agent_id,
          correlationId: rowCorrelationId(item),
          causationId: rowCausationId(item),
          payload: { reasonCode: 'lease_expired', attemptCount: item.attempt_count },
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

  release(itemId: string, leaseToken: string, delayMs: number, reasonCode: string): boolean {
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
            last_error=?, updated_at=?
        WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
      `).run(availableAt, reasonCode, now, itemId, leaseToken, now);
      if (result.changes !== 1) return false;
      this.appendCoordination('agent.work.released', {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: { reasonCode, attemptCount: item.attempt_count },
      });
      return true;
    }).immediate();
  }

  admit(itemId: string, leaseToken: string): boolean {
    return this.settleClaim(itemId, leaseToken, 'admitted');
  }

  expire(itemId: string, leaseToken: string, reasonCode: string): boolean {
    return this.settleClaim(itemId, leaseToken, 'expired', reasonCode);
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

  cancelPending(projectId: string, projectAgentId: string, idempotencyKey?: string): number {
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
      return this.cancelRows(rows, 'user_cancelled');
    }).immediate();
  }

  cancelPendingForTask(projectId: string, taskId: string): number {
    const db = this.database ?? getDb();
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT * FROM agent_inbox_item
        WHERE project_id=? AND status IN ('enqueued','released')
          AND json_extract(command_json, '$.taskId')=?
      `).all(projectId, taskId) as AgentInboxRow[];
      return this.cancelRows(rows, 'task_terminal');
    }).immediate();
  }

  private settleClaim(
    itemId: string,
    leaseToken: string,
    status: 'admitted' | 'expired',
    error?: string,
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
            updated_at=?, settled_at=?
        WHERE id=? AND status='claimed' AND lease_token=? AND lease_expires_at>?
      `).run(status, error ?? null, now, now, itemId, leaseToken, now);
      if (result.changes !== 1) return false;
      this.appendCoordination(`agent.work.${status}`, {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: {
          attemptCount: item.attempt_count,
          ...(error ? { reasonCode: error } : {}),
        },
      });
      return true;
    }).immediate();
  }

  private cancelRows(rows: AgentInboxRow[], reasonCode: string): number {
    if (rows.length === 0) return 0;
    const db = this.database ?? getDb();
    const now = this.now().toISOString();
    let cancelled = 0;
    for (const item of rows) {
      const result = db.prepare(`
        UPDATE agent_inbox_item
        SET status='cancelled', last_error=?, updated_at=?, settled_at=?
        WHERE id=? AND status IN ('enqueued','released')
      `).run(reasonCode, now, now, item.id);
      if (result.changes !== 1) continue;
      cancelled += 1;
      this.appendCoordination('agent.work.cancelled', {
        id: item.id,
        projectId: item.project_id,
        projectAgentId: item.project_agent_id,
        correlationId: rowCorrelationId(item),
        causationId: rowCausationId(item),
        payload: { reasonCode },
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
      dedupeKey: `coordination:${input.id}:${type}:${JSON.stringify(input.payload)}`,
      payload: input.payload,
    });
  }
}
