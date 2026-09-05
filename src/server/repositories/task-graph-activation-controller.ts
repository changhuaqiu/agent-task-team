import { getDb } from '../db';
import { taskRepo, type TaskRow } from './task-repo';

export interface AcceptedTaskGraphActivationInput {
  conversationId: string;
  ownerCommitKey: string;
  tasks: ReadonlyArray<Pick<TaskRow, 'id' | 'agent_id'>>;
  correlationId?: string;
  causationId?: string;
}

export interface AcceptedTaskGraphActivationResult {
  activatedTaskIds: string[];
  currentTasks: TaskRow[];
}

function latestCommitKey(conversationId: string, taskId: string): string | undefined {
  const row = getDb().prepare(`
    SELECT commit_record.idempotency_key
    FROM task_graph_commit commit_record
    JOIN task_action action ON action.id=commit_record.action_id
    WHERE commit_record.conversation_id=?
      AND EXISTS (
        SELECT 1 FROM json_each(action.task_ids) item WHERE item.value=?
      )
    ORDER BY commit_record.revision DESC,commit_record.created_at DESC
    LIMIT 1
  `).get(conversationId, taskId) as { idempotency_key: string } | undefined;
  return row?.idempotency_key;
}

/**
 * Reconciles the accepted coordinator graph's execution eligibility.
 *
 * `ready` means accepted and eligible for dependency scheduling. This module
 * deliberately does not dispatch work; the caller reuses the normal scheduler
 * path after state converges. Ownership checks prevent an old accepted Outcome
 * from overwriting a later replan.
 */
export class TaskGraphActivationController {
  reconcile(input: AcceptedTaskGraphActivationInput): AcceptedTaskGraphActivationResult {
    const db = getDb();
    return db.transaction(() => {
      const activatedTaskIds: string[] = [];
      const currentTasks: TaskRow[] = [];
      for (const frozen of input.tasks) {
        let current = taskRepo.getById(frozen.id);
        if (!current || current.conversation_id !== input.conversationId) continue;
        if (
          current.status === 'proposed'
          && Boolean(current.agent_id)
          && current.agent_id === frozen.agent_id
          && latestCommitKey(input.conversationId, current.id) === input.ownerCommitKey
        ) {
          current = taskRepo.transition(current.id, {
            to: 'ready',
            expectedFrom: 'proposed',
            expectedRevision: current.revision,
            correlationId: input.correlationId,
            causationId: input.causationId,
          });
          if (current) activatedTaskIds.push(current.id);
        }
        if (current) currentTasks.push(current);
      }
      return { activatedTaskIds, currentTasks };
    }).immediate();
  }
}
