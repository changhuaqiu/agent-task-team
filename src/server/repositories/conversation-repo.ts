import { getDb } from '../db/index';

export interface ConversationRow {
  id: string;
  title: string;
  goal: string | null;
  status: string;
  priority: string;
  project_path: string | null;
  use_worktree: number | null;
  git_repo_root: string | null;
  team_pack_id: string | null;
  participants: string | null;
  created_at: string;
  updated_at: string;
}

export const conversationRepo = {
  create(input: { id: string; title: string; goal?: string; priority?: string; project_path?: string; team_pack_id?: string; use_worktree?: boolean; git_repo_root?: string }): ConversationRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO conversation (id, title, goal, status, priority, project_path, use_worktree, git_repo_root, team_pack_id, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.title, input.goal ?? null, input.priority ?? 'p2', input.project_path ?? null, input.use_worktree ? 1 : 0, input.git_repo_root ?? null, input.team_pack_id ?? null, now, now);
    return conversationRepo.getById(input.id)!;
  },

  getById(id: string): ConversationRow | undefined {
    return getDb().prepare('SELECT * FROM conversation WHERE id = ?').get(id) as ConversationRow | undefined;
  },

  list(): ConversationRow[] {
    return getDb().prepare('SELECT * FROM conversation ORDER BY updated_at DESC').all() as ConversationRow[];
  },

  update(
    id: string,
    updates: Partial<Pick<ConversationRow, 'title' | 'goal' | 'status' | 'priority' | 'participants' | 'project_path' | 'use_worktree' | 'git_repo_root'>>,
  ): void {
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
    getDb().prepare(`UPDATE conversation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM conversation WHERE id = ?').run(id);
  },
};
