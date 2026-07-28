import { getDb } from '../db/index';

export interface InvocationRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  session_id: string | null;
  status: string;
  outcome?: 'completed' | 'failed' | 'cancelled' | 'timed_out' | null;
  engine: string | null;
  runtime_id?: string | null;
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
  started_at?: string | null;
  terminated_at?: string | null;
  revision?: number;
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
  runtime_id?: string;
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

type ManagedInvocationOutcome = 'completed' | 'failed' | 'cancelled' | 'timed_out';

export function usesManagedInvocationLifecycle(): boolean {
  const columns = getDb().prepare('PRAGMA table_info(invocation)').all() as Array<{ name: string }>;
  const names = new Set(columns.map((column) => column.name));
  return ['outcome', 'started_at', 'terminated_at', 'revision'].every((name) => names.has(name));
}

function managedOutcome(
  status: string,
  updates?: InvocationUpdateFields,
): ManagedInvocationOutcome {
  if (status === 'succeeded') return 'completed';
  if (status === 'timed_out' || updates?.reason_code?.toLowerCase().includes('timeout')) {
    return 'timed_out';
  }
  if (
    ['canceled', 'cancelled'].includes(status)
    || updates?.reason_code?.toLowerCase().includes('cancel')
  ) {
    return 'cancelled';
  }
  return 'failed';
}

function managedStatus(status: string): string {
  if (status === 'queued') return 'planned';
  if (TERMINAL_INVOCATION_STATUSES.includes(status as (typeof TERMINAL_INVOCATION_STATUSES)[number])) {
    return 'terminated';
  }
  return status;
}

function appendInvocationUpdates(
  sets: string[],
  values: unknown[],
  updates?: InvocationUpdateFields,
): void {
  if (!updates) return;
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'status') continue;
    sets.push(`${key} = ?`);
    values.push(value);
  }
}

function updateManagedStatus(
  id: string,
  legacyStatus: string,
  updates?: InvocationUpdateFields,
): boolean {
  const db = getDb();
  return db.transaction(() => {
    let current = invocationRepo.getById(id);
    if (!current || current.status === 'terminated') return false;

    const target = managedStatus(legacyStatus);
    const path = target === 'running' && current.status === 'planned'
      ? ['starting', 'running']
      : [target];
    let changed = false;

    for (const next of path) {
      if (current.status === next) continue;
      const now = new Date().toISOString();
      const sets = ['status = ?', 'updated_at = ?', 'revision = revision + 1'];
      const values: unknown[] = [next, now];
      if (next === 'running') {
        sets.push('started_at = COALESCE(started_at, ?)');
        values.push(now);
      }
      if (next === 'terminated') {
        sets.push('outcome = ?', 'terminated_at = ?');
        values.push(managedOutcome(legacyStatus, updates), now);
      }
      if (next === path.at(-1)) appendInvocationUpdates(sets, values, updates);
      values.push(id, current.status);
      const result = db.prepare(
        `UPDATE invocation SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
      ).run(...values);
      if (result.changes !== 1) return false;
      changed = true;
      current = invocationRepo.getById(id);
      if (!current) return false;
    }

    if (!changed && current.status === target && updates) {
      const now = new Date().toISOString();
      const sets = ['updated_at = ?', 'revision = revision + 1'];
      const values: unknown[] = [now];
      appendInvocationUpdates(sets, values, updates);
      values.push(id, current.status);
      return db.prepare(
        `UPDATE invocation SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
      ).run(...values).changes === 1;
    }
    return changed || current.status === target;
  }).immediate();
}

export const invocationRepo = {
  create(input: NewInvocation): InvocationRow {
    const now = new Date().toISOString();
    const initialStatus = usesManagedInvocationLifecycle() ? 'planned' : 'queued';
    getDb()
      .prepare(
        `INSERT INTO invocation (id, conversation_id, task_id, agent_id, session_id, status, engine, runtime_id, account_id, prompt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.task_id ?? null,
        input.agent_id,
        input.session_id ?? null,
        initialStatus,
        input.engine ?? null,
        input.runtime_id ?? null,
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
    if (usesManagedInvocationLifecycle()) {
      updateManagedStatus(id, status, updates);
      return;
    }
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
    if (usesManagedInvocationLifecycle()) {
      const now = new Date().toISOString();
      const sets = [
        "status = 'terminated'",
        'outcome = ?',
        'terminated_at = ?',
        'updated_at = ?',
        'revision = revision + 1',
      ];
      const values: unknown[] = [managedOutcome(status, updates), now, now];
      appendInvocationUpdates(sets, values, updates);
      values.push(id);
      return getDb().prepare(`
        UPDATE invocation
        SET ${sets.join(', ')}
        WHERE id = ? AND status != 'terminated'
      `).run(...values).changes === 1;
    }
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
        `SELECT * FROM invocation
         WHERE status NOT IN ('succeeded', 'failed', 'canceled', 'cancelled', 'timed_out', 'terminated')
         ORDER BY created_at ASC`,
      )
      .all() as InvocationRow[];
  },

  failActiveAfterRestart(now = new Date()): number {
    const current = now.toISOString();
    if (usesManagedInvocationLifecycle()) {
      return getDb().prepare(`
        UPDATE invocation
        SET status = 'terminated',
            outcome = 'failed',
            terminated_at = ?,
            reason_code = COALESCE(reason_code, 'process_restarted'),
            error_message = COALESCE(error_message, 'daemon restarted before invocation settled'),
            revision = revision + 1,
            updated_at = ?
        WHERE status != 'terminated'
      `).run(current, current).changes;
    }
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
    const completedPredicate = usesManagedInvocationLifecycle()
      ? "status = 'terminated' AND outcome = 'completed'"
      : "dispatch_status = 'completed'";
    return db.prepare(`
      SELECT * FROM invocation
      WHERE agent_id = ? AND ${completedPredicate}
      ORDER BY created_at DESC LIMIT 1
    `).get(agentId) as InvocationRow | undefined;
  },

  findLatestForSession(sessionId: string): InvocationRow | undefined {
    return getDb().prepare(`
      SELECT * FROM invocation
      WHERE session_id = ?
      ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(sessionId) as InvocationRow | undefined;
  },
};
