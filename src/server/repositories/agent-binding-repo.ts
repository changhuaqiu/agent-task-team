import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { generateSortableId } from './sortable-id';
import type { AgentBindingStatus } from './control-plane-types';

export interface AgentBindingRow {
  id: string;
  conversation_id: string;
  agent_id: string;
  node_id: string;
  runtime_id: string;
  status: AgentBindingStatus;
  active_envelope_id: string | null;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertAgentBindingInput {
  conversationId: string;
  agentId: string;
  nodeId: string;
  runtimeId: string;
  status?: AgentBindingStatus;
}

export const agentBindingRepo = {
  upsert(input: UpsertAgentBindingInput): AgentBindingRow {
    const existing = agentBindingRepo.get(input.conversationId, input.agentId);
    const now = new Date().toISOString();
    const id = existing?.id ?? generateSortableId('bind');
    getDb()
      .prepare(
        `INSERT INTO agent_binding (
          id, conversation_id, agent_id, node_id, runtime_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(conversation_id, agent_id) DO UPDATE SET
          node_id = excluded.node_id,
          runtime_id = excluded.runtime_id,
          status = excluded.status,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        input.conversationId,
        input.agentId,
        input.nodeId,
        input.runtimeId,
        input.status ?? existing?.status ?? 'idle',
        now,
        now,
      );
    return agentBindingRepo.get(input.conversationId, input.agentId)!;
  },

  get(conversationId: string, agentId: string): AgentBindingRow | undefined {
    return getDb()
      .prepare('SELECT * FROM agent_binding WHERE conversation_id = ? AND agent_id = ?')
      .get(conversationId, agentId) as AgentBindingRow | undefined;
  },

  listByConversation(conversationId: string): AgentBindingRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_binding WHERE conversation_id = ? ORDER BY agent_id ASC')
      .all(conversationId) as AgentBindingRow[];
  },

  listByNode(nodeId: string): AgentBindingRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_binding WHERE node_id = ? ORDER BY conversation_id ASC, agent_id ASC')
      .all(nodeId) as AgentBindingRow[];
  },

  markStarted(conversationId: string, agentId: string, envelopeId: string): AgentBindingRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = agentBindingRepo.get(conversationId, agentId);
      if (!previous) return undefined;
      if (previous.status === 'busy' && previous.active_envelope_id === envelopeId) return previous;
      const result = db.prepare(
        `UPDATE agent_binding
         SET status = 'busy', active_envelope_id = ?, last_started_at = ?, last_error = NULL, updated_at = ?
         WHERE conversation_id = ? AND agent_id = ?`,
      )
      .run(envelopeId, now, now, conversationId, agentId);
      if (result.changes !== 1) return undefined;
      new DomainEventPublisher(db).publish({
        type: 'binding.started',
        projectId: conversationId,
        aggregate: { type: 'binding', id: previous.id },
        projectAgentId: agentId,
        occurredAt: now,
        payload: { previousStatus: previous.status, status: 'busy', envelopeId },
      });
      return agentBindingRepo.get(conversationId, agentId);
    }).immediate();
  },

  markFinished(conversationId: string, agentId: string, status: AgentBindingStatus = 'idle'): AgentBindingRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = agentBindingRepo.get(conversationId, agentId);
      if (!previous || (previous.status === status && previous.active_envelope_id === null)) return previous;
      const result = db.prepare(
        `UPDATE agent_binding
         SET status = ?, active_envelope_id = NULL, last_finished_at = ?, updated_at = ?
         WHERE conversation_id = ? AND agent_id = ?`,
      )
      .run(status, now, now, conversationId, agentId);
      if (result.changes !== 1) return undefined;
      new DomainEventPublisher(db).publish({
        type: status === 'idle' ? 'binding.finished' : 'binding.error',
        projectId: conversationId,
        aggregate: { type: 'binding', id: previous.id },
        projectAgentId: agentId,
        occurredAt: now,
        payload: { previousStatus: previous.status, status },
      });
      return agentBindingRepo.get(conversationId, agentId);
    }).immediate();
  },

  markError(conversationId: string, agentId: string, status: AgentBindingStatus, error: string): AgentBindingRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = agentBindingRepo.get(conversationId, agentId);
      if (!previous) return undefined;
      if (
        previous.status === status
        && previous.last_error === error
        && previous.active_envelope_id === null
      ) return previous;
      const result = db.prepare(
        `UPDATE agent_binding
         SET status = ?, active_envelope_id = NULL, last_error = ?, last_finished_at = ?, updated_at = ?
         WHERE conversation_id = ? AND agent_id = ?`,
      )
      .run(status, error, now, now, conversationId, agentId);
      if (result.changes !== 1) return undefined;
      new DomainEventPublisher(db).publish({
        type: 'binding.error',
        projectId: conversationId,
        aggregate: { type: 'binding', id: previous.id },
        projectAgentId: agentId,
        occurredAt: now,
        payload: { previousStatus: previous.status, status },
      });
      return agentBindingRepo.get(conversationId, agentId);
    }).immediate();
  },
};
