import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';

export interface AgentEventRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  type: string;
  payload: string | null;
  created_at: string;
}

export interface NewAgentEvent {
  conversationId: string;
  taskId?: string;
  agentId: string;
  type: string;
  payload?: Record<string, unknown>;
}

export const eventRepo = {
  append(input: NewAgentEvent): string {
    const id = generateSortableId('evt');
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_event (id, conversation_id, task_id, agent_id, type, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.taskId ?? null,
        input.agentId,
        input.type,
        input.payload ? JSON.stringify(input.payload) : null,
        now,
      );
    return id;
  },

  getByConversation(convId: string, options?: { limit?: number }): AgentEventRow[] {
    const limit = options?.limit ?? 100;
    return getDb()
      .prepare(
        'SELECT * FROM agent_event WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ?',
      )
      .all(convId, limit) as AgentEventRow[];
  },

  getByTask(taskId: string): AgentEventRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_event WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as AgentEventRow[];
  },

  getByAgent(agentId: string, options?: { limit?: number }): AgentEventRow[] {
    const limit = options?.limit ?? 100;
    return getDb()
      .prepare('SELECT * FROM agent_event WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(agentId, limit) as AgentEventRow[];
  },
};
