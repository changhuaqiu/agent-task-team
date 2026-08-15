import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';

export interface AgentSessionRow {
  id: string;
  cli_session_id: string | null;
  conversation_id: string;
  agent_id: string;
  engine: string | null;
  runtime_id: string | null;
  account_id: string | null;
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

export interface SessionExecutionProfile {
  engine: string;
  runtimeId: string;
  accountId?: string;
}

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

  create(input: {
    id: string;
    conversationId: string;
    agentId: string;
    taskId?: string;
    seq?: number;
    isolationKey?: string;
    executionProfile?: SessionExecutionProfile;
  }): AgentSessionRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO agent_session (
          id, conversation_id, agent_id, engine, runtime_id, account_id,
          isolation_key, task_id, seq, status, created_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(
        input.id,
        input.conversationId,
        input.agentId,
        input.executionProfile?.engine ?? null,
        input.executionProfile?.runtimeId ?? null,
        input.executionProfile?.accountId ?? null,
        input.isolationKey ?? '',
        input.taskId ?? '',
        input.seq ?? 0,
        now,
      );
    return sessionRepo.getById(input.id)!;
  },

  getOrCreateActive(input: {
    id: string;
    conversationId: string;
    agentId: string;
    taskId?: string;
    seq?: number;
    isolationKey?: string;
    executionProfile?: SessionExecutionProfile;
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

      return binding;
    })();
  },

  releaseUnconfirmedRuntimeSessionId(id: string, runtimeSessionId: string): boolean {
    return getDb().transaction(() => {
      const history = getDb()
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'terminated' AND outcome = 'completed' THEN 1 ELSE 0 END) AS succeeded
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

      const latest = getDb()
        .prepare(
          `SELECT status, outcome, reason_code
           FROM invocation
           WHERE session_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(id) as { status: string; outcome: string | null; reason_code: string | null } | undefined;
      if (
        latest?.status !== 'terminated'
        || latest.outcome !== 'failed'
        || latest.reason_code !== 'acp_session_load_failed'
      ) {
        return false;
      }

      sessionRepo.seal(id, 'runtime_session_load_failed');
      return sessionRepo.getById(id)?.status === 'sealed';
    })();
  },

  sealIfExecutionProfileChanged(id: string, profile: SessionExecutionProfile): boolean {
    return getDb().transaction(() => {
      const session = sessionRepo.getById(id);
      if (!session || session.status !== 'active') return false;

      const latestSuccessful = getDb()
        .prepare(
          `SELECT engine,account_id
           FROM invocation
           WHERE session_id = ? AND status = 'terminated' AND outcome = 'completed'
           ORDER BY created_at DESC,id DESC
           LIMIT 1`,
        )
        .get(id) as { engine: string | null; account_id: string | null } | undefined;
      const establishedEngine = session.engine ?? latestSuccessful?.engine ?? null;
      const establishedAccountIdValue = session.engine !== null
        ? session.account_id
        : latestSuccessful?.account_id ?? null;
      const establishedAccountId = establishedAccountIdValue?.trim() || null;
      const requestedAccountId = profile.accountId?.trim() || null;
      const incompatible = (
        (establishedEngine !== null && establishedEngine !== profile.engine)
        || (session.runtime_id !== null && session.runtime_id !== profile.runtimeId)
        || (
          establishedEngine !== null
          && establishedAccountId !== requestedAccountId
        )
      );

      if (incompatible) {
        sessionRepo.seal(id, 'runtime_profile_changed');
        return sessionRepo.getById(id)?.status === 'sealed';
      }

      getDb()
        .prepare(
          `UPDATE agent_session
           SET engine = ?, runtime_id = ?, account_id = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(profile.engine, profile.runtimeId, requestedAccountId, id);
      return false;
    })();
  },

  incrementMessageCount(id: string): void {
    getDb().prepare('UPDATE agent_session SET message_count = message_count + 1 WHERE id = ?').run(id);
  },

  seal(id: string, reason: string): void {
    const now = new Date().toISOString();
    const db = getDb();
    db.transaction(() => {
      const previous = sessionRepo.getById(id);
      if (!previous || previous.status !== 'active') return;
      const result = db
        .prepare('UPDATE agent_session SET status = ?, seal_reason = ?, sealed_at = ? WHERE id = ? AND status = ?')
        .run('sealed', reason, now, id, 'active');
      if (result.changes !== 1) return;
      new DomainEventPublisher(db).publish({
        type: 'session.sealed',
        projectId: previous.conversation_id,
        aggregate: { type: 'session', id },
        projectAgentId: previous.agent_id,
        dedupeKey: `session:${id}:sealed`,
        occurredAt: now,
        payload: { previousStatus: previous.status, status: 'sealed', reason },
      });
    }).immediate();
  },

  nextSeqForAgent(agentId: string, taskId: string): number {
    const row = getDb()
      .prepare('SELECT MAX(seq) as max_seq FROM agent_session WHERE agent_id = ? AND task_id = ?')
      .get(agentId, taskId) as { max_seq: number | null } | undefined;
    return (row?.max_seq ?? -1) + 1;
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
