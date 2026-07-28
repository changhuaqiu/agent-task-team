import { getDb } from '../db/index';

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

const TERMINAL_INVOCATION_STATUSES = [
  'succeeded',
  'failed',
  'canceled',
  'cancelled',
  'timed_out',
  'terminated',
] as const;

export const invocationRepo = {
  create(input: NewInvocation): InvocationRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
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
    return invocationRepo.getById(input.id)!;
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
    getDb().prepare(`UPDATE invocation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  settleIfActive(
    id: string,
    status: 'succeeded' | 'failed',
    updates?: InvocationUpdateFields,
  ): boolean {
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
    values.push(id, ...TERMINAL_INVOCATION_STATUSES);
    const placeholders = TERMINAL_INVOCATION_STATUSES.map(() => '?').join(', ');
    return getDb().prepare(`
      UPDATE invocation
      SET ${sets.join(', ')}
      WHERE id = ? AND status NOT IN (${placeholders})
    `).run(...values).changes === 1;
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

  failActiveAfterRestart(now = new Date()): number {
    const current = now.toISOString();
    return getDb().prepare(`
      UPDATE invocation
      SET status = 'failed',
          reason_code = COALESCE(reason_code, 'process_restarted'),
          error_message = COALESCE(error_message, 'daemon restarted before invocation settled'),
          updated_at = ?
      WHERE status NOT IN ('succeeded', 'failed', 'canceled', 'cancelled', 'timed_out', 'terminated')
    `).run(current).changes;
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
