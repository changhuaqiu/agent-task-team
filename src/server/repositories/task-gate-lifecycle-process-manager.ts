import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { QualityGateRow } from '../quality-gate/types';
import { workContractRepo } from '../work-contract/repository';
import type { WorkAuthorityRow } from '../work-contract/types';
import { taskGraphRepo } from './task-graph-repo';
import { StaleTaskRevisionError, taskRepo } from './task-repo';

const TASK_GATE_TERMINAL_EVENTS = new Set([
  'gate.passed',
  'gate.changes_requested',
  'gate.rejected',
]);

export class TaskGateLifecycleProcessManager {
  constructor(private readonly database?: Database.Database) {}

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (!TASK_GATE_TERMINAL_EVENTS.has(event.type)) return;
    if (signal.aborted) throw signal.reason ?? new Error('task_gate_lifecycle_aborted');
    const db = this.database ?? getDb();
    db.transaction(() => {
      const gate = db.prepare(`
        SELECT * FROM quality_gate
        WHERE id=? AND target_type='task' AND kind='code_review'
      `).get(event.aggregate.id) as QualityGateRow | undefined;
      if (!gate) return;
      if (db.prepare('SELECT 1 FROM task_action WHERE proof_event_id=?')
        .get(event.eventId)) return;
      const task = taskRepo.getById(gate.target_id);
      if (!task || task.conversation_id !== gate.conversation_id) {
        throw new Error('task_gate_target_missing');
      }
      const artifactRevision = Number(gate.artifact_revision);
      if (!Number.isSafeInteger(artifactRevision) || task.revision !== artifactRevision) {
        throw new StaleTaskRevisionError(task.id, artifactRevision, task.revision);
      }
      if (task.status !== 'in_review') {
        throw new Error(`task_gate_status_invalid:${task.status}`);
      }

      const passed = event.type === 'gate.passed';
      taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: event.actor.id,
        actorType: event.actor.type === 'agent' ? 'agent' : 'system',
        type: 'task.review_recorded',
        taskIds: [task.id],
        proofEventId: event.eventId,
        payload: {
          gateId: gate.id,
          decision: gate.status,
          artifactRevision: gate.artifact_revision,
          reason: gate.decision_reason,
        },
      });
      taskRepo.transition(task.id, {
        to: passed ? 'done' : 'in_progress',
        expectedFrom: 'in_review',
        expectedRevision: task.revision,
        reviewNote: gate.decision_reason ?? undefined,
      });
      this.closeTaskAuthorities(db, {
        taskId: task.id,
        closeExecution: passed,
        correlationId: event.correlationId,
        causationId: event.eventId,
      });
    }).immediate();
  };

  private closeTaskAuthorities(
    db: Database.Database,
    input: {
      taskId: string;
      closeExecution: boolean;
      correlationId: string;
      causationId: string;
    },
  ): void {
    const authorities = db.prepare(`
      SELECT authority.* FROM work_authority authority
      JOIN work_contract contract ON contract.id=authority.current_contract_id
      WHERE contract.task_id=? AND authority.status='active'
    `).all(input.taskId) as WorkAuthorityRow[];
    const taskPrefix = `task:${input.taskId}:`;
    for (const authority of authorities) {
      if (!authority.work_id.startsWith(taskPrefix)) continue;
      const reviewerWork = authority.work_id.endsWith(':purpose:review');
      if (!input.closeExecution && !reviewerWork) continue;
      workContractRepo.close({
        workId: authority.work_id,
        expectedEpoch: authority.current_epoch,
        correlationId: input.correlationId,
        causationId: input.causationId,
      });
    }
  }
}
