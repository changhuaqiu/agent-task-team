import crypto from 'node:crypto';
import { getDb } from '../db/index';
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
    getDb()
      .prepare('UPDATE execution_envelope SET status = ?, reason_code = ?, updated_at = ? WHERE id = ?')
      .run(status, reasonCode ?? null, now, id);
    return executionEnvelopeRepo.getById(id);
  },

  expireStale(now = new Date()): number {
    const current = now.toISOString();
    const result = getDb()
      .prepare(
        `UPDATE execution_envelope
         SET status = 'expired', reason_code = 'ttl_expired', updated_at = ?
         WHERE expires_at < ? AND status NOT IN ('completed', 'failed', 'blocked', 'expired')`,
      )
      .run(current, current);
    return result.changes;
  },
};
