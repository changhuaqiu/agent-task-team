import { getDb } from '../db';

export interface AgentLogCursorRow {
  agent_id: string;
  project_id: string;
  last_consumed_id: string;
  consumed_at: string;
}

export const agentLogCursorRepo = {
  get(projectId: string, agentId: string): AgentLogCursorRow | undefined {
    return getDb().prepare(
      'SELECT * FROM agent_log_cursor WHERE project_id = ? AND agent_id = ?',
    ).get(projectId, agentId) as AgentLogCursorRow | undefined;
  },

  upsert(projectId: string, agentId: string, lastConsumedId: string): AgentLogCursorRow {
    const consumedAt = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO agent_log_cursor (agent_id, project_id, last_consumed_id, consumed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, project_id) DO UPDATE SET
        last_consumed_id = excluded.last_consumed_id,
        consumed_at = excluded.consumed_at
    `).run(agentId, projectId, lastConsumedId, consumedAt);
    return this.get(projectId, agentId)!;
  },
};
