import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import { proofToTeamLogEntry, teamLogProjection } from '../team-log/TeamLogProjection';

export interface ProofEventRow {
  id: string;
  event_type: string;
  conversation_id: string | null;
  task_id: string | null;
  chain_id: string | null;
  pass_id: string | null;
  envelope_id: string | null;
  node_id: string | null;
  agent_id: string | null;
  actor_id: string | null;
  reason_code: string | null;
  metadata: string | null;
  created_at: string;
}

export interface AppendProofEventInput {
  eventType: string;
  conversationId?: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  envelopeId?: string;
  nodeId?: string;
  agentId?: string;
  actorId?: string;
  reasonCode?: string;
  metadata?: Record<string, unknown>;
}

export const proofLogRepo = {
  append(input: AppendProofEventInput): ProofEventRow {
    const id = generateSortableId('proof');
    const now = new Date().toISOString();
    const row: ProofEventRow = {
      id,
      event_type: input.eventType,
      conversation_id: input.conversationId ?? null,
      task_id: input.taskId ?? null,
      chain_id: input.chainId ?? null,
      pass_id: input.passId ?? null,
      envelope_id: input.envelopeId ?? null,
      node_id: input.nodeId ?? null,
      agent_id: input.agentId ?? null,
      actor_id: input.actorId ?? null,
      reason_code: input.reasonCode ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      created_at: now,
    };
    getDb()
      .prepare(
        `INSERT INTO control_proof_event (
          id, event_type, conversation_id, task_id, chain_id, pass_id,
          envelope_id, node_id, agent_id, actor_id, reason_code, metadata, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.eventType,
        input.conversationId ?? null,
        input.taskId ?? null,
        input.chainId ?? null,
        input.passId ?? null,
        input.envelopeId ?? null,
        input.nodeId ?? null,
        input.agentId ?? null,
        input.actorId ?? null,
        input.reasonCode ?? null,
        row.metadata,
        now,
      );
    const entry = proofToTeamLogEntry(row);
    if (entry) teamLogProjection.append(entry);
    return row;
  },

  getByEnvelope(envelopeId: string): ProofEventRow[] {
    return getDb()
      .prepare('SELECT * FROM control_proof_event WHERE envelope_id = ? ORDER BY created_at ASC, id ASC')
      .all(envelopeId) as ProofEventRow[];
  },

  getByConversation(conversationId: string, options?: { limit?: number }): ProofEventRow[] {
    const limit = options?.limit ?? 200;
    return getDb()
      .prepare(`SELECT * FROM (
        SELECT * FROM control_proof_event
        WHERE conversation_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      ) ORDER BY created_at ASC, id ASC`)
      .all(conversationId, limit) as ProofEventRow[];
  },

  findByType(input: { eventType: string; conversationId: string; taskId?: string; reasonCode?: string }): ProofEventRow[] {
    return getDb()
      .prepare(`SELECT * FROM control_proof_event
        WHERE event_type = ? AND conversation_id = ?
          AND (? IS NULL OR task_id = ?)
          AND (? IS NULL OR reason_code = ?)
        ORDER BY created_at ASC, id ASC`)
      .all(
        input.eventType,
        input.conversationId,
        input.taskId ?? null,
        input.taskId ?? null,
        input.reasonCode ?? null,
        input.reasonCode ?? null,
      ) as ProofEventRow[];
  },
};
