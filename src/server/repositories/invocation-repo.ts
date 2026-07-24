import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';

export interface InvocationRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  session_id: string | null;
  status: string;
  engine: string | null;
  account_id: string | null;
  cli_session_id: string | null;
  prompt: string | null;
  exit_code: number | null;
  reason_code: string | null;
  usage: string | null;
  error_message: string | null;
  dispatch_status: string | null;
  token_usage: string | null;
  lease_expiry: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewInvocation {
  id: string;
  conversation_id: string;
  task_id?: string;
  agent_id: string;
  session_id?: string;
  engine?: string;
  account_id?: string;
  prompt?: string;
}

type InvocationUpdateFields = Partial<
  Pick<
    InvocationRow,
    | 'status'
    | 'exit_code'
    | 'reason_code'
    | 'usage'
    | 'error_message'
    | 'cli_session_id'
    | 'session_id'
  >
>;

export const invocationRepo = {
  create(input: NewInvocation): InvocationRow {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO invocation (id, conversation_id, task_id, agent_id, session_id, status, engine, account_id, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.task_id ?? null,
        input.agent_id,
        input.session_id ?? null,
        input.engine ?? null,
        input.account_id ?? null,
        input.prompt ?? null,
        now,
        now,
      );
      new DomainEventPublisher(db).publish({
        type: 'invocation.queued',
        projectId: input.conversation_id,
        aggregate: { type: 'invocation', id: input.id },
        streamKey: `domain-invocation:${input.id}`,
        projectAgentId: input.agent_id,
        dedupeKey: `invocation:${input.id}:queued`,
        occurredAt: now,
        payload: { status: 'queued', taskId: input.task_id },
      });
      return invocationRepo.getById(input.id)!;
    }).immediate();
  },

  getById(id: string): InvocationRow | undefined {
    return getDb().prepare('SELECT * FROM invocation WHERE id = ?').get(id) as
      | InvocationRow
      | undefined;
  },

  updateStatus(id: string, status: string, updates?: InvocationUpdateFields): void {
    const now = new Date().toISOString();
    const sets: string[] = ['status = ?', 'updated_at = ?'];
    const values: unknown[] = [status, now];
    if (updates) {
      for (const [key, value] of Object.entries(updates)) {
        if (key === 'status') continue;
        sets.push(`${key} = ?`);
        values.push(value);
      }
    }
    values.push(id);
    const db = getDb();
    db.transaction(() => {
      const previous = invocationRepo.getById(id);
      if (!previous || previous.status === status) return;
      if (['succeeded', 'cancelled', 'canceled'].includes(previous.status)) return;
      if (previous.status === 'failed' && status !== 'running') return;
      const result = db.prepare(`UPDATE invocation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes !== 1) return;
      const type = status === 'running'
        ? 'invocation.claimed'
        : status === 'succeeded'
          ? 'invocation.succeeded'
          : status === 'failed' || status === 'canceled' || status === 'cancelled'
            ? 'invocation.failed'
            : undefined;
      if (!type) return;
      new DomainEventPublisher(db).publish({
        type,
        projectId: previous.conversation_id,
        aggregate: { type: 'invocation', id },
        streamKey: `domain-invocation:${id}`,
        projectAgentId: previous.agent_id,
        occurredAt: now,
        payload: {
          previousStatus: previous.status,
          status,
          ...((updates?.reason_code) ? { reasonCode: updates.reason_code } : {}),
        } as never,
      });
    }).immediate();
  },

  getByAgent(agentId: string, options?: { limit?: number }): InvocationRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare('SELECT * FROM invocation WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(agentId, limit) as InvocationRow[];
  },

  getByConversation(convId: string): InvocationRow[] {
    return getDb()
      .prepare('SELECT * FROM invocation WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(convId) as InvocationRow[];
  },

  getActive(): InvocationRow[] {
    return getDb()
      .prepare(
        "SELECT * FROM invocation WHERE status NOT IN ('succeeded', 'failed', 'canceled') ORDER BY created_at ASC",
      )
      .all() as InvocationRow[];
  },

  listRecent(options?: { limit?: number }): InvocationRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare('SELECT * FROM invocation ORDER BY created_at DESC LIMIT ?')
      .all(limit) as InvocationRow[];
  },

  updateDispatchStatus(id: string, dispatchStatus: string, extra?: { tokenUsage?: string }): void {
    const db = getDb();
    const now = new Date().toISOString();
    const sets: string[] = ['dispatch_status = ?', 'updated_at = ?'];
    const values: (string | null)[] = [dispatchStatus, now];

    if (extra?.tokenUsage !== undefined) {
      sets.push('token_usage = ?');
      values.push(extra.tokenUsage);
    }

    values.push(id);
    db.prepare(`UPDATE invocation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  findLatestCompletedForAgent(agentId: string): InvocationRow | undefined {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM invocation
      WHERE agent_id = ? AND dispatch_status = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `).get(agentId) as InvocationRow | undefined;
  },
};
