import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { taskRepo, type TaskRow } from './task-repo';
import { enqueueStandaloneTask } from './task-graph-outcome-process-manager';

function dependenciesSatisfied(task: TaskRow): boolean {
  let dependencies: unknown;
  try {
    dependencies = task.dependencies ? JSON.parse(task.dependencies) : [];
  } catch {
    return false;
  }
  return Array.isArray(dependencies) && dependencies.every((dependency) => (
    typeof dependency === 'string' && taskRepo.getById(dependency)?.status === 'done'
  ));
}

/** Wakes standalone proposal Tasks only when every declared dependency is done. */
export class TaskGraphSchedulerProcessManager {
  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'task.done') return;
    if (signal.aborted) throw signal.reason ?? new Error('task_graph_scheduler_aborted');
    const db = getDb();
    const candidates = taskRepo.getByConversation(event.projectId).filter((task) => (
      task.status === 'ready' && Boolean(task.agent_id) && dependenciesSatisfied(task)
    ));
    for (const task of candidates) {
      const provenance = db.prepare(`
        WITH latest_commit AS (
          SELECT commit_record.idempotency_key,commit_record.revision
          FROM task_graph_commit commit_record
          JOIN task_action action ON action.id=commit_record.action_id
          WHERE EXISTS (
            SELECT 1 FROM json_each(action.task_ids) item WHERE item.value=?
          )
          ORDER BY commit_record.revision DESC,commit_record.created_at DESC
          LIMIT 1
        ), latest_proposal AS (
          SELECT outcome.id outcome_id,outcome.contract_id,contract.delivery_run_id
          FROM latest_commit commit_record
          JOIN agent_outcome outcome ON (
            commit_record.idempotency_key='task-graph-outcome:' || outcome.id
            OR EXISTS (
              SELECT 1 FROM platform_event legacy_event
              WHERE legacy_event.id=commit_record.idempotency_key
                AND legacy_event.type='agent.outcome.accepted'
                AND legacy_event.aggregate_type='agent_outcome'
                AND legacy_event.aggregate_id=outcome.id
            )
          )
          JOIN work_contract contract ON contract.id=outcome.contract_id
          WHERE outcome.admission_status='accepted'
            AND outcome.outcome_type='propose_task_graph'
        )
        SELECT outcome_id,contract_id
        FROM latest_proposal
        WHERE delivery_run_id IS NULL
      `).get(task.id) as { outcome_id: string; contract_id: string } | undefined;
      if (!provenance) continue;
      const outcome = db.prepare('SELECT * FROM agent_outcome WHERE id=?')
        .get(provenance.outcome_id) as AgentOutcomeRow | undefined;
      const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
        .get(provenance.contract_id) as WorkContractRow | undefined;
      if (!outcome || !contract) continue;
      enqueueStandaloneTask(contract, outcome, task);
    }
  };
}
