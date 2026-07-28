import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { taskCommandService } from './task-command-service';
import { taskRepo, type TaskRow } from './task-repo';

type TaskOutcomeType =
  | 'submit_task_result'
  | 'request_review'
  | 'report_blocked'
  | 'request_human_decision';

function outcomeSummary(outcome: AgentOutcomeRow): string | undefined {
  try {
    const payload = JSON.parse(outcome.payload_json) as Record<string, unknown>;
    for (const candidate of [payload.summary, payload.reason, payload.message]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
  } catch {
    // Contract admission preserves the raw payload; summary is optional.
  }
  return undefined;
}

function frozenTaskRevision(contract: WorkContractRow): number {
  const revisions = JSON.parse(contract.authoritative_revisions_json) as Record<string, unknown>;
  if (!Number.isSafeInteger(revisions.task) || Number(revisions.task) < 0) {
    throw new Error('task_outcome_contract_revision_missing');
  }
  return Number(revisions.task);
}

function acceptedTaskOutcome(
  db: Database.Database,
  outcomeId: string,
): { outcome: AgentOutcomeRow; contract: WorkContractRow; task: TaskRow } | undefined {
  const outcome = db.prepare(`
    SELECT * FROM agent_outcome
    WHERE id=? AND admission_status='accepted'
      AND outcome_type IN (
        'submit_task_result','request_review','report_blocked','request_human_decision'
      )
  `).get(outcomeId) as AgentOutcomeRow | undefined;
  if (!outcome) return undefined;
  const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
    .get(outcome.contract_id) as WorkContractRow | undefined;
  if (!contract?.task_id) throw new Error('task_outcome_contract_task_missing');
  const task = taskRepo.getById(contract.task_id);
  if (!task || task.conversation_id !== contract.project_id) {
    throw new Error('task_outcome_task_scope_mismatch');
  }
  return { outcome, contract, task };
}

export class TaskOutcomeProcessManager {
  constructor(private readonly database?: Database.Database) {}

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('task_outcome_processing_aborted');
    const db = this.database ?? getDb();
    const accepted = acceptedTaskOutcome(db, event.aggregate.id);
    if (!accepted) return;
    const { outcome, contract, task } = accepted;
    const idempotencyKey = `task-outcome:${event.eventId}`;
    taskCommandService.applyOutcome({
      conversationId: task.conversation_id,
      taskId: task.id,
      expectedTaskRevision: frozenTaskRevision(contract),
      expectedGraphRevision: taskCommandService.expectedGraphRevision(
        task.conversation_id,
        idempotencyKey,
      ),
      idempotencyKey,
      actor: { type: 'agent', id: contract.agent_id },
      correlationId: event.correlationId,
      causationId: event.eventId,
      outcomeId: outcome.id,
      outcomeType: outcome.outcome_type as TaskOutcomeType,
      agentId: contract.agent_id,
      evidenceRefs: JSON.parse(outcome.evidence_refs_json) as string[],
      proofEventId: event.eventId,
      summary: outcomeSummary(outcome),
    });
  };
}
