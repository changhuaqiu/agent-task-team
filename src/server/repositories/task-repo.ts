import { getDb } from '../db/index';

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

export const taskRepo = {
  create(input: NewTask): TaskRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO task (id, conversation_id, title, description, status, agent_id, dependencies, artifacts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.title,
        input.description ?? null,
        input.agent_id,
        input.dependencies ? JSON.stringify(input.dependencies) : null,
        input.artifacts ? JSON.stringify(input.artifacts) : null,
        now,
        now,
      );
    return taskRepo.getById(input.id)!;
  },

  getById(id: string): TaskRow | undefined {
    return getDb().prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  },

  getByConversation(conversationId: string): TaskRow[] {
    return getDb()
      .prepare('SELECT * FROM task WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as TaskRow[];
  },

  getByAgent(agentId: string): TaskRow[] {
    return getDb()
      .prepare('SELECT * FROM task WHERE agent_id = ? ORDER BY created_at DESC')
      .all(agentId) as TaskRow[];
  },

  updateStatus(id: string, status: string, reviewNote?: string): void {
    const now = new Date().toISOString();
    if (reviewNote !== undefined) {
      getDb()
        .prepare('UPDATE task SET status = ?, review_note = ?, updated_at = ? WHERE id = ?')
        .run(status, reviewNote, now, id);
    } else {
      getDb().prepare('UPDATE task SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
    }
  },

  update(id: string, updates: Partial<Pick<TaskRow, 'title' | 'description' | 'status' | 'agent_id' | 'dependencies' | 'artifacts' | 'review_note' | 'work_dir'>>): void {
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
    getDb().prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  list(): TaskRow[] {
    return getDb().prepare('SELECT * FROM task ORDER BY created_at ASC').all() as TaskRow[];
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM task WHERE id = ?').run(id);
  },
};
