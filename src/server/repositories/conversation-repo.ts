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
  project_id: string | null;
  workspace_kind: 'project_workspace' | 'historical_workstream' | 'workstream';
}

export const conversationRepo = {
  create(input: { id: string; title: string; goal?: string; priority?: string; project_path?: string; team_pack_id?: string; use_worktree?: boolean; git_repo_root?: string; project_id?: string; workspace_kind?: ConversationRow['workspace_kind'] }): ConversationRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO conversation (id, title, goal, status, priority, project_path, use_worktree, git_repo_root, team_pack_id, created_at, updated_at, project_id, workspace_kind)
         VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, input.title, input.goal ?? null, input.priority ?? 'p2', input.project_path ?? null, input.use_worktree ? 1 : 0, input.git_repo_root ?? null, input.team_pack_id ?? null, now, now, input.project_id ?? null, input.workspace_kind ?? 'workstream');
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

  deleteAggregate(id: string): boolean {
    const db = getDb();
    return db.transaction(() => {
      const exists = db.prepare('SELECT 1 FROM conversation WHERE id = ?').get(id);
      if (!exists) return false;

      // Autonomous runs own their actions, attempts and receipts through CASCADE.
      // Remove them before tasks so root_task_id cannot block aggregate deletion.
      db.prepare('DELETE FROM autonomous_delivery_run WHERE conversation_id = ?').run(id);

      // Evaluation tables were introduced across multiple local migration drafts.
      // Delete the aggregate explicitly so both CASCADE-enabled databases and
      // older checkpoint databases with NO ACTION foreign keys remain deletable.
      db.prepare('DELETE FROM eval_pairwise_round WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_review_queue WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_case_execution WHERE conversation_id = ?').run(id);
      db.prepare(
        `DELETE FROM eval_experiment_item
         WHERE experiment_id IN (SELECT id FROM eval_experiment WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare('DELETE FROM eval_change_proposal WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_budget_reservation WHERE conversation_id = ?').run(id);
      db.prepare(`DELETE FROM eval_annotation
        WHERE conversation_id = ?
          OR run_id IN (SELECT id FROM eval_run WHERE conversation_id = ?)`)
        .run(id, id);
      db.prepare(
        `DELETE FROM eval_judge_attempt
         WHERE run_id IN (SELECT id FROM eval_run WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM eval_score
         WHERE run_id IN (SELECT id FROM eval_run WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM eval_gap
         WHERE run_id IN (SELECT id FROM eval_run WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare(
        `DELETE FROM eval_job
         WHERE run_id IN (SELECT id FROM eval_run WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare('DELETE FROM eval_experiment WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_run WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_subject_snapshot WHERE conversation_id = ?').run(id);
      db.prepare(
        `DELETE FROM eval_case
         WHERE dataset_id IN (SELECT id FROM eval_dataset WHERE conversation_id = ?)`,
      ).run(id);
      db.prepare('DELETE FROM eval_dataset WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_application_snapshot WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM eval_policy WHERE conversation_id = ?').run(id);

      // Task Graph dependents reference both task and task_action without legacy cascades.
      db.prepare('DELETE FROM chat_task_binding WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM task_artifact_ref WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM task_edge WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM task_action WHERE conversation_id = ?').run(id);

      // Delete A2ACollaboration leaves before their owning aggregate root.
      db.prepare(
        `DELETE FROM a2a_handoff_packet
         WHERE chain_id IN (
           SELECT id FROM a2a_possession_chain WHERE conversation_id = ?
         )`,
      ).run(id);
      db.prepare(
        `DELETE FROM a2a_pass
         WHERE chain_id IN (
           SELECT id FROM a2a_possession_chain WHERE conversation_id = ?
         )`,
      ).run(id);
      db.prepare(
        `DELETE FROM a2a_pass_group
         WHERE chain_id IN (
           SELECT id FROM a2a_possession_chain WHERE conversation_id = ?
         )`,
      ).run(id);
      db.prepare(
        `DELETE FROM a2a_possession
         WHERE chain_id IN (
           SELECT id FROM a2a_possession_chain WHERE conversation_id = ?
         )`,
      ).run(id);
      db.prepare('DELETE FROM a2a_possession_chain WHERE conversation_id = ?').run(id);

      // Runtime/control-plane and observability projections.
      db.prepare('DELETE FROM agent_binding WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM execution_envelope WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM control_proof_event WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM observation_span WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM agent_log_cursor WHERE project_id = ?').run(id);

      // Remaining project-scoped records have no transitive dependents.
      db.prepare('DELETE FROM agent_mailbox WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM phase WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM agent_session WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM invocation WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM agent_event WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM chat_message WHERE conversation_id = ?').run(id);
      db.prepare('DELETE FROM task WHERE conversation_id = ?').run(id);

      const deleted = db.prepare('DELETE FROM conversation WHERE id = ?').run(id);
      return deleted.changes === 1;
    })();
  },
};
