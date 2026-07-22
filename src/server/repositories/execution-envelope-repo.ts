import crypto from 'node:crypto';
import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import type {
  AgentBindingStatus,
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

  sendIfRoutedAndLive(id: string, now = new Date()): ExecutionEnvelopeRow | undefined {
    const current = now.toISOString();
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE execution_envelope
         SET status = 'sent', reason_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'routed' AND expires_at >= ?`,
      )
      .run(current, id, current);
    if (result.changes === 1) return executionEnvelopeRepo.getById(id);
    db.prepare(
      `UPDATE execution_envelope
       SET status = 'expired', reason_code = 'ttl_expired', updated_at = ?
       WHERE id = ? AND status = 'routed' AND expires_at < ?`,
    ).run(current, id, current);
    return undefined;
  },

  listRecoverableTmux(ownerNodeId?: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare(
        `SELECT * FROM execution_envelope
         WHERE json_extract(payload, '$.executorKind') = 'tmux_pane'
           AND (
             status = 'started'
             OR (
               (status = 'sent' OR (status = 'expired' AND reason_code IN ('ttl_expired', 'dispatch_expired')))
               AND json_extract(payload, '$.executorRef.tmuxServerId') IS NOT NULL
             )
           )
           AND (
             ? IS NULL
             OR json_extract(payload, '$.executorOwnerNodeId') = ?
             OR json_extract(payload, '$.executorOwnerNodeId') IS NULL
           )
         ORDER BY created_at ASC, id ASC`,
      )
      .all(ownerNodeId ?? null, ownerNodeId ?? null) as ExecutionEnvelopeRow[];
  },

  listUnclassifiedStartedForNode(nodeId: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare(
        `SELECT * FROM execution_envelope
         WHERE status = 'started' AND to_node_id = ?
           AND json_extract(payload, '$.executorKind') IS NULL
         ORDER BY created_at ASC, id ASC`,
      )
      .all(nodeId) as ExecutionEnvelopeRow[];
  },

  startIfSentAndLive(id: string, now = new Date()): ExecutionEnvelopeRow | undefined {
    const current = now.toISOString();
    const result = getDb()
      .prepare(
        `UPDATE execution_envelope
         SET status = 'started', reason_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'sent' AND expires_at >= ?`,
      )
      .run(current, id, current);
    return result.changes === 1 ? executionEnvelopeRepo.getById(id) : undefined;
  },

  completeIfStarted(id: string): ExecutionEnvelopeRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const result = db.prepare(
        `UPDATE execution_envelope
         SET status = 'completed', reason_code = NULL, updated_at = ?
         WHERE id = ? AND status = 'started'`,
      ).run(now, id);
      if (result.changes !== 1) return undefined;
      const envelope = executionEnvelopeRepo.getById(id)!;
      db.prepare(
        `UPDATE agent_binding
         SET status = 'idle', active_envelope_id = NULL,
             last_finished_at = ?, updated_at = ?
         WHERE conversation_id = ? AND agent_id = ? AND active_envelope_id = ?`,
      ).run(now, now, envelope.conversation_id, envelope.to_agent_id, envelope.id);
      return envelope;
    })();
  },

  failIfNonTerminal(
    id: string,
    reasonCode: string,
    options?: {
      bindingStatus?: AgentBindingStatus;
      invocationId?: string;
      invocationErrorMessage?: string;
    },
  ): ExecutionEnvelopeRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const result = db.prepare(
        `UPDATE execution_envelope
         SET status = 'failed', reason_code = ?, updated_at = ?
         WHERE id = ?
           AND status IN ('drafted', 'validated', 'queued', 'routed', 'sent', 'started')`,
      ).run(reasonCode, now, id);
      if (result.changes !== 1) return undefined;
      const envelope = executionEnvelopeRepo.getById(id)!;
      const bindingStatus = options?.bindingStatus ?? 'idle';
      if (bindingStatus === 'idle') {
        db.prepare(
          `UPDATE agent_binding
           SET status = 'idle', active_envelope_id = NULL,
               last_finished_at = ?, updated_at = ?
           WHERE conversation_id = ? AND agent_id = ? AND active_envelope_id = ?`,
        ).run(now, now, envelope.conversation_id, envelope.to_agent_id, envelope.id);
      } else {
        db.prepare(
          `UPDATE agent_binding
           SET status = ?, active_envelope_id = NULL, last_error = ?,
               last_finished_at = ?, updated_at = ?
           WHERE conversation_id = ? AND agent_id = ? AND active_envelope_id = ?`,
        ).run(
          bindingStatus,
          reasonCode,
          now,
          now,
          envelope.conversation_id,
          envelope.to_agent_id,
          envelope.id,
        );
      }
      if (options?.invocationId) {
        db.prepare(
          `UPDATE invocation
           SET status = 'failed', reason_code = ?, error_message = ?, updated_at = ?
           WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'canceled')`,
        ).run(
          reasonCode,
          options.invocationErrorMessage ?? `execution failed: ${reasonCode}`,
          now,
          options.invocationId,
        );
      }
      return envelope;
    })();
  },

  bindExecutor(
    id: string,
    executorRef: NonNullable<ExecutionEnvelopePayload['executorRef']>,
  ): ExecutionEnvelopeRow | undefined {
    const envelope = executionEnvelopeRepo.getById(id);
    if (!envelope || envelope.status !== 'sent') return undefined;
    const payload = JSON.parse(envelope.payload) as ExecutionEnvelopePayload;
    const now = new Date().toISOString();
    const result = getDb()
      .prepare(
        `UPDATE execution_envelope
         SET payload = ?, updated_at = ?
         WHERE id = ? AND status = 'sent'`,
      )
      .run(JSON.stringify({ ...payload, executorRef }), now, id);
    return result.changes === 1 ? executionEnvelopeRepo.getById(id) : undefined;
  },

  recoverTmuxAfterRestart(id: string, reasonCode = 'process_restarted'): ExecutionEnvelopeRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    const candidate = executionEnvelopeRepo.getById(id);
    if (!candidate) return undefined;
    let payload: ExecutionEnvelopePayload;
    try {
      payload = JSON.parse(candidate.payload) as ExecutionEnvelopePayload;
    } catch {
      return undefined;
    }
    if (payload.executorKind !== 'tmux_pane') return undefined;
    return db.transaction(() => {
      const result = db
        .prepare(
        `UPDATE execution_envelope
         SET status = 'expired', reason_code = ?, updated_at = ?
         WHERE id = ?
           AND (status IN ('sent', 'started') OR (status = 'expired' AND reason_code IN ('ttl_expired', 'dispatch_expired', ?)))
           AND json_extract(payload, '$.executorKind') = 'tmux_pane'`,
        )
        .run(reasonCode, now, id, reasonCode);
      const existing = executionEnvelopeRepo.getById(id);
      if (
        result.changes !== 1
        && !(existing?.status === 'expired' && existing.reason_code === reasonCode)
      ) return undefined;
      db.prepare(
        `UPDATE agent_binding
         SET status = 'idle', active_envelope_id = NULL,
             last_finished_at = ?, updated_at = ?
         WHERE conversation_id = ? AND agent_id = ? AND active_envelope_id = ?`,
      ).run(now, now, candidate.conversation_id, candidate.to_agent_id, candidate.id);
      if (payload.executorRef?.invocationId) {
        db.prepare(
          `UPDATE invocation
           SET status = 'failed', reason_code = ?,
               error_message = 'tmux execution was terminated after daemon restart', updated_at = ?
           WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'canceled')`,
        ).run(reasonCode, now, payload.executorRef.invocationId);
      }
      return executionEnvelopeRepo.getById(id);
    })();
  },

  expireStartedAfterRestart(
    nodeId: string,
    includeLegacyLocal = true,
    now = new Date(),
  ): ExecutionEnvelopeRow[] {
    const current = now.toISOString();
    const db = getDb();
    const candidates = db
      .prepare(
        `SELECT * FROM execution_envelope
         WHERE status = 'started'
           AND (
             (json_extract(payload, '$.executorKind') = 'daemon_process' AND to_node_id = ?)
             OR (
               json_extract(payload, '$.executorKind') = 'bridge_proxy'
               AND json_extract(payload, '$.executorOwnerNodeId') = ?
             )
             OR (
               json_extract(payload, '$.executorKind') IS NULL
               AND (to_node_id LIKE 'bridge:%' OR (? = 1 AND to_node_id = ?))
             )
           )`,
      )
      .all(nodeId, nodeId, includeLegacyLocal ? 1 : 0, nodeId) as ExecutionEnvelopeRow[];
    const expire = db.prepare(
      `UPDATE execution_envelope
       SET status = 'expired', reason_code = 'process_restarted', updated_at = ?
       WHERE id = ? AND status = 'started'`,
    );
    const finishBinding = db.prepare(
      `UPDATE agent_binding
       SET status = 'idle', active_envelope_id = NULL,
           last_finished_at = ?, updated_at = ?
       WHERE conversation_id = ? AND agent_id = ? AND active_envelope_id = ?`,
    );
    const failInvocationById = db.prepare(
      `UPDATE invocation
       SET status = 'failed', reason_code = 'process_restarted',
           error_message = 'execution owner process restarted', updated_at = ?
       WHERE id = ? AND status NOT IN ('succeeded', 'failed', 'canceled')`,
    );
    const failLegacyInvocations = db.prepare(
      `UPDATE invocation
       SET status = 'failed', reason_code = 'process_restarted',
           error_message = 'execution owner process restarted', updated_at = ?
       WHERE conversation_id = ? AND agent_id = ?
         AND status NOT IN ('succeeded', 'failed', 'canceled')
         AND (? IS NULL OR task_id = ?)
         AND created_at >= ?`,
    );
    return db.transaction(() => candidates.filter((candidate) => {
      if (expire.run(current, candidate.id).changes !== 1) return false;
      finishBinding.run(
        current,
        current,
        candidate.conversation_id,
        candidate.to_agent_id,
        candidate.id,
      );
      let invocationId: string | undefined;
      try {
        const payload = JSON.parse(candidate.payload) as { executorRef?: { invocationId?: unknown } };
        if (typeof payload.executorRef?.invocationId === 'string') {
          invocationId = payload.executorRef.invocationId;
        }
      } catch { /* legacy payload falls back to execution scope */ }
      if (invocationId) {
        failInvocationById.run(current, invocationId);
      } else {
        failLegacyInvocations.run(
          current,
          candidate.conversation_id,
          candidate.to_agent_id,
          candidate.task_id,
          candidate.task_id,
          candidate.created_at,
        );
      }
      return true;
    }))();
  },

  expireStalePending(now = new Date()): number {
    const current = now.toISOString();
    const result = getDb()
      .prepare(
        `UPDATE execution_envelope
         SET status = 'expired', reason_code = 'ttl_expired', updated_at = ?
         WHERE expires_at < ? AND status IN ('drafted', 'validated', 'queued', 'routed', 'sent')`,
      )
      .run(current, current);
    return result.changes;
  },
};
