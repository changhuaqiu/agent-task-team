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
  settled_at?: string | null;
  revision?: number;
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

const ADMISSION_ORDER = [
  'drafted',
  'validated',
  'routed',
  'sent',
  'acknowledged',
] as const satisfies readonly ExecutionEnvelopeStatus[];

type AdmissionStatus = (typeof ADMISSION_ORDER)[number] | 'rejected' | 'expired';

function usesAdmissionLifecycle(): boolean {
  const columns = getDb()
    .prepare('PRAGMA table_info(execution_envelope)')
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  return names.has('revision') && names.has('settled_at');
}

function normalizeAdmissionStatus(status: ExecutionEnvelopeStatus): AdmissionStatus {
  switch (status) {
    case 'queued':
      return 'validated';
    case 'started':
    case 'completed':
      return 'acknowledged';
    case 'blocked':
    case 'failed':
      return 'rejected';
    default:
      return status;
  }
}

function admissionPath(
  from: AdmissionStatus,
  to: AdmissionStatus,
): AdmissionStatus[] {
  if (from === to || ['acknowledged', 'rejected', 'expired'].includes(from)) return [];
  if (to === 'rejected' || to === 'expired') return [to];

  const fromIndex = ADMISSION_ORDER.indexOf(from as (typeof ADMISSION_ORDER)[number]);
  const toIndex = ADMISSION_ORDER.indexOf(to as (typeof ADMISSION_ORDER)[number]);
  if (fromIndex < 0 || toIndex <= fromIndex) return [];
  return ADMISSION_ORDER.slice(fromIndex + 1, toIndex + 1);
}

function updateAdmissionStatus(
  id: string,
  status: ExecutionEnvelopeStatus,
  reasonCode?: string,
): ExecutionEnvelopeRow | undefined {
  const db = getDb();
  return db.transaction(() => {
    let current = executionEnvelopeRepo.getById(id);
    if (!current) return undefined;

    const target = normalizeAdmissionStatus(status);
    const path = admissionPath(
      normalizeAdmissionStatus(current.status),
      target,
    );
    for (const next of path) {
      const now = new Date().toISOString();
      const terminal = ['acknowledged', 'rejected', 'expired'].includes(next);
      const nextReason = next === 'rejected'
        ? reasonCode?.trim() || 'legacy_dispatch_rejected'
        : next === 'expired'
          ? reasonCode ?? null
          : null;
      const result = db.prepare(`
        UPDATE execution_envelope
        SET status = ?, reason_code = ?, settled_at = ?,
            revision = revision + 1, updated_at = ?
        WHERE id = ? AND status = ?
      `).run(
        next,
        nextReason,
        terminal ? now : null,
        now,
        id,
        current.status,
      );
      if (result.changes !== 1) return executionEnvelopeRepo.getById(id);
      current = executionEnvelopeRepo.getById(id);
      if (!current) return undefined;
    }
    return current;
  }).immediate();
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
    if (usesAdmissionLifecycle()) {
      return updateAdmissionStatus(id, status, reasonCode);
    }
    const now = new Date().toISOString();
    getDb()
      .prepare('UPDATE execution_envelope SET status = ?, reason_code = ?, updated_at = ? WHERE id = ?')
      .run(status, reasonCode ?? null, now, id);
    return executionEnvelopeRepo.getById(id);
  },

  expireStale(now = new Date()): number {
    const current = now.toISOString();
    if (usesAdmissionLifecycle()) {
      const result = getDb()
        .prepare(
          `UPDATE execution_envelope
           SET status = 'expired', reason_code = 'ttl_expired',
               settled_at = ?, revision = revision + 1, updated_at = ?
           WHERE expires_at < ?
             AND status NOT IN ('acknowledged', 'rejected', 'expired')`,
        )
        .run(current, current, current);
      return result.changes;
    }
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
