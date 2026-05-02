import { getDb } from '../db/index';

export interface AgentSessionRow {
  id: string;
  cli_session_id: string | null;
  conversation_id: string;
  agent_id: string;
  task_id: string;
  seq: number;
  status: string;
  context_health: string | null;
  usage_snapshot: string | null;
  message_count: number;
  seal_reason: string | null;
  created_at: string;
  sealed_at: string | null;
}

export const sessionRepo = {
  findActive(agentId: string, taskId: string): AgentSessionRow | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM agent_session WHERE agent_id = ? AND task_id = ? AND status = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(agentId, taskId, 'active') as AgentSessionRow | undefined;
  },

  findActiveByConversation(agentId: string, conversationId: string): AgentSessionRow | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM agent_session WHERE agent_id = ? AND conversation_id = ? AND status = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(agentId, conversationId, 'active') as AgentSessionRow | undefined;
  },

  findByAgentAndTask(agentId: string, taskId: string): AgentSessionRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_session WHERE agent_id = ? AND task_id = ? ORDER BY seq ASC')
      .all(agentId, taskId) as AgentSessionRow[];
  },

  create(input: {
    id: string;
    conversationId: string;
    agentId: string;
    taskId?: string;
    seq?: number;
  }): AgentSessionRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(input.id, input.conversationId, input.agentId, input.taskId ?? '', input.seq ?? 0, now);
    return sessionRepo.getById(input.id)!;
  },

  getById(id: string): AgentSessionRow | undefined {
    return getDb().prepare('SELECT * FROM agent_session WHERE id = ?').get(id) as
      | AgentSessionRow
      | undefined;
  },

  updateCliSessionId(id: string, cliSessionId: string): void {
    getDb().prepare('UPDATE agent_session SET cli_session_id = ? WHERE id = ?').run(cliSessionId, id);
  },

  incrementMessageCount(id: string): void {
    getDb().prepare('UPDATE agent_session SET message_count = message_count + 1 WHERE id = ?').run(id);
  },

  seal(id: string, reason: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare('UPDATE agent_session SET status = ?, seal_reason = ?, sealed_at = ? WHERE id = ?')
      .run('sealed', reason, now, id);
  },

  sealByTask(agentId: string, taskId: string, reason: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        'UPDATE agent_session SET status = ?, seal_reason = ?, sealed_at = ? WHERE agent_id = ? AND task_id = ? AND status = ?',
      )
      .run('sealed', reason, now, agentId, taskId, 'active');
  },

  sealByConversation(agentId: string, conversationId: string, reason: string): void {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        'UPDATE agent_session SET status = ?, seal_reason = ?, sealed_at = ? WHERE agent_id = ? AND conversation_id = ? AND status = ?',
      )
      .run('sealed', reason, now, agentId, conversationId, 'active');
  },

  countByAgentAndConversation(agentId: string, conversationId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) as cnt FROM agent_session WHERE agent_id = ? AND conversation_id = ?')
      .get(agentId, conversationId) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  },

  nextSeqForAgent(agentId: string, taskId: string): number {
    const row = getDb()
      .prepare('SELECT MAX(seq) as max_seq FROM agent_session WHERE agent_id = ? AND task_id = ?')
      .get(agentId, taskId) as { max_seq: number | null } | undefined;
    return (row?.max_seq ?? -1) + 1;
  },

  listActiveByAgent(agentId: string): AgentSessionRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_session WHERE agent_id = ? AND status = ? ORDER BY created_at DESC')
      .all(agentId, 'active') as AgentSessionRow[];
  },

  findLatestActiveByAgent(agentId: string): AgentSessionRow | undefined {
    return getDb()
      .prepare("SELECT * FROM agent_session WHERE agent_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get(agentId) as AgentSessionRow | undefined;
  },

  listActiveByConversation(convId: string): AgentSessionRow[] {
    return getDb()
      .prepare('SELECT * FROM agent_session WHERE conversation_id = ? AND status = ?')
      .all(convId, 'active') as AgentSessionRow[];
  },

  listAllActive(): AgentSessionRow[] {
    return getDb()
      .prepare("SELECT * FROM agent_session WHERE status = 'active' ORDER BY created_at DESC")
      .all() as AgentSessionRow[];
  },
};
