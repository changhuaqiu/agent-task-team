import { getDb } from '../db/index';

export interface AgentEventRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  type: string;
  payload: string | null;
  created_at: string;
}

/** Read-only compatibility access for historical agent_event rows. */
export const eventRepo = {
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
