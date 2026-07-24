import crypto from 'node:crypto';
import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { generateSortableId } from './sortable-id';
import type {
  DispatchIntent,
  DispatchSource,
  ExecutionEnvelopePayload,
  ExecutionEnvelopeStatus,
} from './control-plane-types';

export interface ExecutionEnvelopeRow {
  id: string;
  source: DispatchSource;
  intent: DispatchIntent;
  conversation_id: string;
  task_id: string | null;
  chain_id: string | null;
  pass_id: string | null;
  from_node_id: string;
  from_agent_id: string | null;
  to_node_id: string;
  to_agent_id: string;
  payload: string;
  ttl_ms: number;
  nonce: string;
  status: ExecutionEnvelopeStatus;
  reason_code: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateExecutionEnvelopeInput {
  source: DispatchSource;
  intent: DispatchIntent;
  conversationId: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  fromNodeId: string;
  fromAgentId?: string;
  toNodeId: string;
  toAgentId: string;
  payload?: ExecutionEnvelopePayload;
  ttlMs?: number;
}

const ENVELOPE_TERMINAL_STATUSES = new Set<ExecutionEnvelopeStatus>([
  'blocked',
  'failed',
  'completed',
  'expired',
]);

export const executionEnvelopeRepo = {
  create(input: CreateExecutionEnvelopeInput): ExecutionEnvelopeRow {
    const id = generateSortableId('env');
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const ttlMs = input.ttlMs ?? 120_000;
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    getDb()
      .prepare(
        `INSERT INTO execution_envelope (
          id, source, intent, conversation_id, task_id, chain_id, pass_id,
          from_node_id, from_agent_id, to_node_id, to_agent_id, payload,
          ttl_ms, nonce, status, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?, ?)`,
      )
      .run(
        id,
        input.source,
        input.intent,
        input.conversationId,
        input.taskId ?? null,
        input.chainId ?? null,
        input.passId ?? null,
        input.fromNodeId,
        input.fromAgentId ?? null,
        input.toNodeId,
        input.toAgentId,
        JSON.stringify(input.payload ?? { contextRefs: [] }),
        ttlMs,
        crypto.randomBytes(12).toString('hex'),
        expiresAt,
        now,
        now,
      );
    return executionEnvelopeRepo.getById(id)!;
  },

  getById(id: string): ExecutionEnvelopeRow | undefined {
    return getDb()
      .prepare('SELECT * FROM execution_envelope WHERE id = ?')
      .get(id) as ExecutionEnvelopeRow | undefined;
  },

  listByConversation(conversationId: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare('SELECT * FROM execution_envelope WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as ExecutionEnvelopeRow[];
  },

  listRunnableForNode(nodeId: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare(
        `SELECT * FROM execution_envelope
         WHERE to_node_id = ? AND status IN ('validated', 'queued', 'routed', 'sent')
         ORDER BY created_at ASC, id ASC`,
      )
      .all(nodeId) as ExecutionEnvelopeRow[];
  },

  updateStatus(id: string, status: ExecutionEnvelopeStatus, reasonCode?: string): ExecutionEnvelopeRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = executionEnvelopeRepo.getById(id);
      if (!previous || previous.status === status) return undefined;
      if (ENVELOPE_TERMINAL_STATUSES.has(previous.status)) return undefined;
      const result = db
        .prepare(`
          UPDATE execution_envelope
          SET status = ?, reason_code = ?, updated_at = ?
          WHERE id = ? AND status NOT IN ('blocked','failed','completed','expired')
        `)
        .run(status, reasonCode ?? null, now, id);
      if (result.changes !== 1) return undefined;
      const type = status === 'validated' || status === 'blocked'
        || status === 'queued' || status === 'routed'
        || status === 'sent' || status === 'started' || status === 'completed'
        || status === 'failed' || status === 'expired'
        ? `envelope.${status}` as const
        : undefined;
      if (type) {
        new DomainEventPublisher(db).publish({
          type,
          projectId: previous.conversation_id,
          aggregate: { type: 'envelope', id },
          projectAgentId: previous.to_agent_id,
          occurredAt: now,
          payload: {
            previousStatus: previous.status,
            status,
            ...(reasonCode ? { reasonCode } : {}),
          } as never,
        });
      }
      return executionEnvelopeRepo.getById(id);
    }).immediate();
  },

  expireStale(now = new Date()): number {
    const current = now.toISOString();
    const db = getDb();
    return db.transaction(() => {
      const expired = db.prepare(
        `SELECT id FROM execution_envelope
         WHERE expires_at < ? AND status NOT IN ('completed', 'failed', 'blocked', 'expired')`,
      ).all(current) as Array<{ id: string }>;
      let changed = 0;
      for (const row of expired) {
        if (executionEnvelopeRepo.updateStatus(row.id, 'expired', 'ttl_expired')) changed += 1;
      }
      return changed;
    }).immediate();
  },
};
