import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import { taskGraphRepo, type ArtifactKind } from './task-graph-repo';
import {
  StaleTaskRevisionError,
  taskRepo,
  type TaskRow,
} from './task-repo';

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

function artifactKind(reference: string): ArtifactKind {
  if (/^https?:\/\//i.test(reference)) return 'url';
  if (/\btest|coverage|junit|vitest|playwright\b/i.test(reference)) return 'test';
  if (/\.(?:md|mdx|docx?|pdf)$/i.test(reference)) return 'doc';
  if (/[/\\]|\.[a-z0-9]+$/i.test(reference)) return 'file';
  return 'proof';
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
    db.transaction(() => {
      const accepted = acceptedTaskOutcome(db, event.aggregate.id);
      if (!accepted) return;
      if (db.prepare('SELECT 1 FROM task_action WHERE proof_event_id=?')
        .get(event.eventId)) return;

      const { outcome, contract } = accepted;
      let task = taskRepo.getById(accepted.task.id)!;
      const expectedRevision = frozenTaskRevision(contract);
      if (task.revision !== expectedRevision) {
        throw new StaleTaskRevisionError(task.id, expectedRevision, task.revision);
      }

      const outcomeType = outcome.outcome_type as TaskOutcomeType;
      const summary = outcomeSummary(outcome);
      if (outcomeType === 'submit_task_result' || outcomeType === 'request_review') {
        if (task.status === 'ready') {
          task = taskRepo.transition(task.id, {
            to: 'in_progress',
            expectedFrom: 'ready',
            expectedRevision: task.revision,
          })!;
        }
        if (task.status !== 'in_progress') {
          throw new Error(`task_outcome_status_invalid:${task.status}`);
        }
        const action = taskGraphRepo.appendAction({
          conversationId: task.conversation_id,
          actorId: contract.agent_id,
          actorType: 'agent',
          type: 'task.review_requested',
          taskIds: [task.id],
          proofEventId: event.eventId,
          payload: {
            outcomeId: outcome.id,
            outcomeType,
            evidenceRefs: JSON.parse(outcome.evidence_refs_json) as unknown,
            ...(summary ? { summary } : {}),
          },
        });
        for (const reference of JSON.parse(outcome.evidence_refs_json) as string[]) {
          taskGraphRepo.addArtifact({
            conversationId: task.conversation_id,
            taskId: task.id,
            kind: artifactKind(reference),
            label: reference,
            ...(/^https?:\/\//i.test(reference) ? { url: reference } : { path: reference }),
            proofEventId: event.eventId,
            createdByActionId: action.id,
          });
        }
        taskRepo.transition(task.id, {
          to: 'in_review',
          expectedFrom: 'in_progress',
          expectedRevision: task.revision,
          reviewNote: summary,
        });
        return;
      }

      if (task.status === 'ready') {
        task = taskRepo.transition(task.id, {
          to: 'in_progress',
          expectedFrom: 'ready',
          expectedRevision: task.revision,
        })!;
      }
      if (task.status !== 'in_progress') {
        throw new Error(`task_blocked_outcome_status_invalid:${task.status}`);
      }
      taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: contract.agent_id,
        actorType: 'agent',
        type: 'task.blocked',
        taskIds: [task.id],
        proofEventId: event.eventId,
        payload: {
          outcomeId: outcome.id,
          outcomeType,
          ...(summary ? { summary } : {}),
        },
      });
      taskRepo.transition(task.id, {
        to: 'blocked',
        expectedFrom: 'in_progress',
        expectedRevision: task.revision,
        reviewNote: summary ?? outcomeType,
      });
    }).immediate();
  };
}
