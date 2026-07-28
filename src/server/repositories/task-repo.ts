import { getDb } from '../db/index';

const MANAGED_TASK_STATUSES = new Set(['proposed', 'ready', 'in_progress', 'blocked', 'in_review', 'done', 'cancelled']);

const MANAGED_TASK_TRANSITIONS: Record<string, string[]> = {
  proposed: ['ready', 'cancelled'],
  ready: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'in_review', 'cancelled'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  in_review: ['done', 'in_progress', 'blocked', 'cancelled'],
  done: ['ready'],
  cancelled: [],
};

export interface TaskRow {
  id: string;
  conversation_id: string;
  title: string;
  description: string | null;
  status: string;
  agent_id: string;
  dependencies: string | null;
  artifacts: string | null;
  review_note: string | null;
  work_dir: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTask {
  id: string;
  conversation_id: string;
  title: string;
  description?: string;
  agent_id: string;
  dependencies?: string[];
  artifacts?: Record<string, unknown>;
}

function usesManagedTaskLifecycle(): boolean {
  const trigger = getDb()
    .prepare(
      `SELECT 1
       FROM sqlite_master
       WHERE type = 'trigger'
         AND tbl_name = 'task'
         AND sql LIKE '%invalid_task_status%'
       LIMIT 1`,
    )
    .get();
  return trigger !== undefined;
}

function hasTaskRevisionColumn(): boolean {
  return (getDb().prepare('PRAGMA table_info(task)').all() as Array<{ name: string }>).some((column) => column.name === 'revision');
}

function toManagedTaskStatus(status: string): string {
  const aliases: Record<string, string> = {
    pending: 'ready',
    completed: 'done',
    rejected: 'blocked',
    approved: 'done',
  };
  const managed = aliases[status] ?? status;
  if (!MANAGED_TASK_STATUSES.has(managed)) {
    throw new Error(`unsupported_managed_task_status:${status}`);
  }
  return managed;
}

function fromManagedTaskStatus(status: string): string {
  return status === 'ready' ? 'pending' : status;
}

function normalizeTask(row: TaskRow | undefined, managed = usesManagedTaskLifecycle()): TaskRow | undefined {
  if (!row || !managed) return row;
  return { ...row, status: fromManagedTaskStatus(row.status) };
}

function findManagedTransitionPath(from: string, to: string): string[] {
  if (from === to) return [];

  const queue: Array<{ status: string; path: string[] }> = [{ status: from, path: [] }];
  const visited = new Set([from]);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of MANAGED_TASK_TRANSITIONS[current.status] ?? []) {
      if (visited.has(next)) continue;
      const path = [...current.path, next];
      if (next === to) return path;
      visited.add(next);
      queue.push({ status: next, path });
    }
  }

  throw new Error(`unreachable_managed_task_transition:${from}->${to}`);
}

function updateManagedStatus(id: string, requestedStatus: string, reviewNote?: string | null): void {
  const db = getDb();
  const desiredStatus = toManagedTaskStatus(requestedStatus);
  const hasRevision = hasTaskRevisionColumn();
  const update = db.transaction(() => {
    const row = db.prepare('SELECT status FROM task WHERE id = ?').get(id) as { status: string } | undefined;
    if (!row) return;

    const path = findManagedTransitionPath(row.status, desiredStatus);
    const now = new Date().toISOString();
    if (path.length === 0) {
      const revisionSql = hasRevision ? ', revision = revision + 1' : '';
      if (reviewNote === undefined) {
        db.prepare(`UPDATE task SET updated_at = ?${revisionSql} WHERE id = ?`).run(now, id);
      } else {
        db.prepare(`UPDATE task SET review_note = ?, updated_at = ?${revisionSql} WHERE id = ?`).run(reviewNote, now, id);
      }
      return;
    }

    path.forEach((status, index) => {
      const finalStep = index === path.length - 1;
      const reviewSql = finalStep && reviewNote !== undefined ? ', review_note = ?' : '';
      const revisionSql = hasRevision ? ', revision = revision + 1' : '';
      const values: unknown[] = [status];
      if (finalStep && reviewNote !== undefined) values.push(reviewNote);
      values.push(now, id);
      db.prepare(
        `UPDATE task
         SET status = ?${reviewSql}, updated_at = ?${revisionSql}
         WHERE id = ?`,
      ).run(...values);
    });
  });
  update.immediate();
}

export const taskRepo = {
  create(input: NewTask): TaskRow {
    const now = new Date().toISOString();
    const initialStatus = usesManagedTaskLifecycle() ? 'ready' : 'pending';
    getDb()
      .prepare(
        `INSERT INTO task (id, conversation_id, title, description, status, agent_id, dependencies, artifacts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.conversation_id, input.title, input.description ?? null, initialStatus, input.agent_id, input.dependencies ? JSON.stringify(input.dependencies) : null, input.artifacts ? JSON.stringify(input.artifacts) : null, now, now);
    return taskRepo.getById(input.id)!;
  },

  getById(id: string): TaskRow | undefined {
    return normalizeTask(getDb().prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined);
  },

  getByConversation(conversationId: string): TaskRow[] {
    const managed = usesManagedTaskLifecycle();
    const rows = getDb().prepare('SELECT * FROM task WHERE conversation_id = ? ORDER BY created_at ASC').all(conversationId) as TaskRow[];
    return rows.map((row) => normalizeTask(row, managed)!);
  },

  getByAgent(agentId: string): TaskRow[] {
    const managed = usesManagedTaskLifecycle();
    const rows = getDb().prepare('SELECT * FROM task WHERE agent_id = ? ORDER BY created_at DESC').all(agentId) as TaskRow[];
    return rows.map((row) => normalizeTask(row, managed)!);
  },

  updateStatus(id: string, status: string, reviewNote?: string): void {
    if (usesManagedTaskLifecycle()) {
      updateManagedStatus(id, status, reviewNote);
      return;
    }
    const now = new Date().toISOString();
    if (reviewNote !== undefined) {
      getDb().prepare('UPDATE task SET status = ?, review_note = ?, updated_at = ? WHERE id = ?').run(status, reviewNote, now, id);
    } else {
      getDb().prepare('UPDATE task SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  },

  update(id: string, updates: Partial<Pick<TaskRow, 'title' | 'description' | 'status' | 'agent_id' | 'dependencies' | 'artifacts' | 'review_note' | 'work_dir'>>): void {
    if (usesManagedTaskLifecycle() && updates.status !== undefined) {
      const { status, review_note: reviewNote, ...otherUpdates } = updates;
      const apply = getDb().transaction(() => {
        taskRepo.update(id, otherUpdates);
        updateManagedStatus(id, status, reviewNote);
      });
      apply.immediate();
      return;
    }
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    getDb()
      .prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`)
      .run(...values);
  },

  list(): TaskRow[] {
    const managed = usesManagedTaskLifecycle();
    const rows = getDb().prepare('SELECT * FROM task ORDER BY created_at ASC').all() as TaskRow[];
    return rows.map((row) => normalizeTask(row, managed)!);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM task WHERE id = ?').run(id);
  },
};
