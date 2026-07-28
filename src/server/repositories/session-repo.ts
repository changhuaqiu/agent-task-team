import { getDb } from '../db/index';
import { usesManagedInvocationLifecycle } from './invocation-repo';

export interface AgentSessionRow {
  id: string;
  cli_session_id: string | null;
  conversation_id: string;
  agent_id: string;
  isolation_key: string;
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

export type SessionIdentityBindResult =
  | { status: 'bound' | 'unchanged'; current: string }
  | { status: 'mismatch'; current: string };

export const sessionRepo = {
  findActive(agentId: string, taskId: string): AgentSessionRow | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM agent_session WHERE agent_id = ? AND task_id = ? AND status = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(agentId, taskId, 'active') as AgentSessionRow | undefined;
  },

  findActiveByConversation(agentId: string, conversationId: string, isolationKey = ''): AgentSessionRow | undefined {
    return getDb()
      .prepare(
        'SELECT * FROM agent_session WHERE agent_id = ? AND conversation_id = ? AND isolation_key = ? AND status = ? ORDER BY seq DESC LIMIT 1',
      )
      .get(agentId, conversationId, isolationKey, 'active') as AgentSessionRow | undefined;
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
    isolationKey?: string;
  }): AgentSessionRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_session (id, conversation_id, agent_id, isolation_key, task_id, seq, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(input.id, input.conversationId, input.agentId, input.isolationKey ?? '', input.taskId ?? '', input.seq ?? 0, now);
    return sessionRepo.getById(input.id)!;
  },

  getOrCreateActive(input: {
    id: string;
    conversationId: string;
    agentId: string;
    taskId?: string;
    seq?: number;
    isolationKey?: string;
  }): AgentSessionRow {
    return getDb().transaction(() => {
      const existing = sessionRepo.findActiveByConversation(
        input.agentId,
        input.conversationId,
        input.isolationKey ?? '',
      );
      if (existing) return existing;
      try {
        return sessionRepo.create(input);
      } catch (error) {
        // A concurrent creator may have won the partial unique index race.
        const winner = sessionRepo.findActiveByConversation(
          input.agentId,
          input.conversationId,
          input.isolationKey ?? '',
        );
        if (winner) return winner;
        throw error;
      }
    })();
  },

  getById(id: string): AgentSessionRow | undefined {
    return getDb().prepare('SELECT * FROM agent_session WHERE id = ?').get(id) as
      | AgentSessionRow
      | undefined;
  },

  updateCliSessionId(id: string, cliSessionId: string): void {
    const result = sessionRepo.bindRuntimeSessionId(id, cliSessionId);
    if (result.status === 'mismatch') {
      throw new Error(
        `session_identity_changed: binding ${id} already uses ${result.current}, received ${cliSessionId}`,
      );
    }
  },

  bindRuntimeSessionId(id: string, runtimeSessionId: string): SessionIdentityBindResult {
    return getDb().transaction(() => {
      const row = sessionRepo.getById(id);
      if (!row) throw new Error(`session_not_found: ${id}`);
      if (row.cli_session_id === runtimeSessionId) {
        return { status: 'unchanged', current: runtimeSessionId } as const;
      }
      if (row.cli_session_id) {
        return { status: 'mismatch', current: row.cli_session_id } as const;
      }
      const updated = getDb()
        .prepare('UPDATE agent_session SET cli_session_id = ? WHERE id = ? AND cli_session_id IS NULL')
        .run(runtimeSessionId, id);
      if (updated.changes === 1) {
        return { status: 'bound', current: runtimeSessionId } as const;
      }
      const concurrent = sessionRepo.getById(id)?.cli_session_id;
      if (concurrent === runtimeSessionId) {
        return { status: 'unchanged', current: runtimeSessionId } as const;
      }
      if (concurrent) return { status: 'mismatch', current: concurrent } as const;
      throw new Error(`session_bind_failed: ${id}`);
    })();
  },

  confirmRuntimeSessionId(
    id: string,
    runtimeSessionId: string,
    invocationId: string,
  ): SessionIdentityBindResult {
    return getDb().transaction(() => {
      const row = sessionRepo.getById(id);
      if (!row) throw new Error(`session_not_found: ${id}`);
      const invocation = getDb()
        .prepare('SELECT session_id FROM invocation WHERE id = ?')
        .get(invocationId) as { session_id: string | null } | undefined;
      if (!invocation || invocation.session_id !== id) {
        throw new Error(`session_invocation_mismatch: ${invocationId}`);
      }

      let binding: SessionIdentityBindResult;
      if (row.cli_session_id === runtimeSessionId) {
        binding = { status: 'unchanged', current: runtimeSessionId };
      } else if (row.cli_session_id) {
        binding = { status: 'mismatch', current: row.cli_session_id };
      } else {
        const updated = getDb()
          .prepare('UPDATE agent_session SET cli_session_id = ? WHERE id = ? AND cli_session_id IS NULL')
          .run(runtimeSessionId, id);
        if (updated.changes !== 1) {
          const concurrent = sessionRepo.getById(id)?.cli_session_id;
          binding = concurrent === runtimeSessionId
            ? { status: 'unchanged', current: runtimeSessionId }
            : { status: 'mismatch', current: concurrent ?? 'unbound' };
        } else {
          binding = { status: 'bound', current: runtimeSessionId };
        }
      }

      if (binding.status === 'mismatch') return binding;
      if (usesManagedInvocationLifecycle()) {
        getDb()
          .prepare(
            `UPDATE invocation
             SET cli_session_id = ?, updated_at = ?, revision = revision + 1
             WHERE id = ? AND status != 'terminated'`,
          )
          .run(runtimeSessionId, new Date().toISOString(), invocationId);
        return binding;
      }
      getDb()
        .prepare(
          `UPDATE invocation
           SET status = 'succeeded', exit_code = 0, cli_session_id = ?, updated_at = ?
           WHERE id = ?
             AND status NOT IN ('succeeded', 'failed', 'canceled', 'cancelled', 'timed_out', 'terminated')`,
        )
        .run(runtimeSessionId, new Date().toISOString(), invocationId);
      return binding;
    })();
  },

  releaseUnconfirmedRuntimeSessionId(id: string, runtimeSessionId: string): boolean {
    return getDb().transaction(() => {
      const succeededPredicate = usesManagedInvocationLifecycle()
        ? "status = 'terminated' AND outcome = 'completed'"
        : "status = 'succeeded'";
      const history = getDb()
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN ${succeededPredicate} THEN 1 ELSE 0 END) AS succeeded
           FROM invocation
           WHERE session_id = ?`,
        )
        .get(id) as { total: number; succeeded: number | null };
      if (history.total === 0 || (history.succeeded ?? 0) > 0) return false;

      const cleared = getDb()
        .prepare(
          'UPDATE agent_session SET cli_session_id = NULL WHERE id = ? AND cli_session_id = ?',
        )
        .run(id, runtimeSessionId);
      return cleared.changes === 1;
    })();
  },

  sealIfLatestInvocationLoadFailed(id: string): boolean {
    return getDb().transaction(() => {
      const session = sessionRepo.getById(id);
      if (!session || session.status !== 'active' || !session.cli_session_id) return false;

      const managedLifecycle = usesManagedInvocationLifecycle();
      const latest = getDb()
        .prepare(
          `SELECT status, reason_code${managedLifecycle ? ', outcome' : ''}
           FROM invocation
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(id) as {
          status: string;
          reason_code: string | null;
          outcome?: string | null;
        } | undefined;
      const failedStatus = managedLifecycle ? 'terminated' : 'failed';
      if (
        latest?.status !== failedStatus
        || latest.reason_code !== 'acp_session_load_failed'
        || (managedLifecycle && latest.outcome !== 'failed')
      ) {
        return false;
      }

      const now = new Date().toISOString();
      const sealed = getDb()
        .prepare(
          `UPDATE agent_session
           SET status = 'sealed', seal_reason = 'runtime_session_load_failed', sealed_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(now, id);
      return sealed.changes === 1;
    })();
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
