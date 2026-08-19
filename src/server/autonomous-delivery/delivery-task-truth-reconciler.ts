import { getDb } from '../db';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { proofLogRepo } from '../repositories/proof-log-repo';
import {
  StaleTaskGraphRevisionError,
  taskGraphRepo,
} from '../repositories/task-graph-repo';
import { taskRepo, type TaskRow, type TaskStatus } from '../repositories/task-repo';
import { canTransitionTask } from '../../shared/task-status';

const RECONCILIATION_REASON = 'delivery_terminal_projection_reconciled';

interface ReconciliationCandidate {
  task_id: string;
  conversation_id: string;
  agent_id: string;
  status: TaskStatus;
  revision: number;
  delivery_run_id: string;
  completed_at: string;
}

interface StatusAction {
  id: string;
  type: string;
  status: string;
  proof_event_id: string | null;
  created_at: string;
}

interface TaskCompletionEvent {
  stream_sequence: number;
}

export interface DeliveryTaskTruthReconcilerOptions {
  intervalMs?: number;
  batchSize?: number;
  now?: () => Date;
}

export interface DeliveryTaskTruthReconciliationResult {
  scanned: number;
  repaired: number;
}

class StaleDeliveryTaskProjectionError extends Error {}

function reconciliationPath(from: TaskStatus): TaskStatus[] {
  if (from === 'proposed') return ['ready', 'in_progress', 'in_review', 'done'];
  if (from === 'ready') return ['in_progress', 'in_review', 'done'];
  if (from === 'in_progress') return ['in_review', 'done'];
  if (from === 'blocked') return ['in_progress', 'in_review', 'done'];
  if (from === 'in_review') return ['done'];
  return [];
}

/**
 * Repairs a Task read projection only when a completed DeliveryRun can point
 * to the Task's own, pre-completion review receipt. Delivery completion is not
 * treated as evidence that every linked Task should be marked done.
 */
export class DeliveryTaskTruthReconciler {
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private timer?: NodeJS.Timeout;

  constructor(options: DeliveryTaskTruthReconcilerOptions = {}) {
    this.intervalMs = options.intervalMs
      ?? Number(process.env.DELIVERY_TASK_TRUTH_RECONCILE_INTERVAL_MS || 60_000);
    this.batchSize = options.batchSize ?? 100;
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.runSafely();
    this.timer = setInterval(() => this.runSafely(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  runOnce(): DeliveryTaskTruthReconciliationResult {
    let scanned = 0;
    let repaired = 0;
    let cursor: Pick<ReconciliationCandidate, 'completed_at' | 'task_id'> | undefined;
    while (true) {
      const candidates = this.listCandidates(cursor);
      if (candidates.length === 0) break;
      scanned += candidates.length;
      for (const candidate of candidates) {
        const sourceAction = this.latestStatusActionBeforeCompletion(candidate);
        const completionEvent = sourceAction
          ? this.reviewedCompletionEvent(candidate, sourceAction)
          : undefined;
        if (
          !sourceAction
          || sourceAction.type !== 'task.review_recorded'
          || sourceAction.status !== 'done'
          || !this.hasPassedReviewReceipt(candidate, sourceAction)
          || !completionEvent
          || this.wasRevokedBeforeCompletion(candidate, completionEvent)
        ) continue;
        try {
          if (this.repair(candidate, sourceAction)) repaired += 1;
        } catch (error) {
          if (
            error instanceof StaleTaskGraphRevisionError
            || error instanceof StaleDeliveryTaskProjectionError
          ) continue;
          throw error;
        }
      }
      const last = candidates.at(-1)!;
      cursor = { completed_at: last.completed_at, task_id: last.task_id };
      if (candidates.length < this.batchSize) break;
    }
    return { scanned, repaired };
  }

  private runSafely(): void {
    try {
      this.runOnce();
    } catch (error) {
      console.error('[delivery-task-truth] reconciliation failed:', error);
    }
  }

  private listCandidates(
    after?: Pick<ReconciliationCandidate, 'completed_at' | 'task_id'>,
  ): ReconciliationCandidate[] {
    return getDb().prepare(`
      WITH links AS (
        SELECT DISTINCT
          task.id AS task_id,
          task.conversation_id,
          task.agent_id,
          task.status,
          task.revision,
          run.id AS delivery_run_id,
          run.completed_at
        FROM task
        JOIN work_contract contract
          ON contract.task_id=task.id
         AND contract.project_id=task.conversation_id
        JOIN autonomous_delivery_run run
          ON run.id=contract.delivery_run_id
         AND run.conversation_id=task.conversation_id
        WHERE task.status NOT IN ('done','cancelled')
          AND run.status='completed'
          AND run.completed_at IS NOT NULL
      ), ranked AS (
        SELECT links.*,
          ROW_NUMBER() OVER (
            PARTITION BY task_id
            ORDER BY completed_at DESC,delivery_run_id DESC
          ) AS rank
        FROM links
      )
      SELECT
        task_id,conversation_id,agent_id,status,revision,
        delivery_run_id,completed_at
      FROM ranked
      WHERE rank=1
        AND (
          ? IS NULL
          OR completed_at>?
          OR (completed_at=? AND task_id>?)
        )
      ORDER BY completed_at ASC,task_id ASC
      LIMIT ?
    `).all(
      after?.completed_at ?? null,
      after?.completed_at ?? null,
      after?.completed_at ?? null,
      after?.task_id ?? null,
      this.batchSize,
    ) as ReconciliationCandidate[];
  }

  private latestStatusActionBeforeCompletion(
    candidate: ReconciliationCandidate,
  ): StatusAction | undefined {
    return getDb().prepare(`
      SELECT
        action.id,
        action.type,
        action.proof_event_id,
        json_extract(
          CASE WHEN json_valid(action.payload) THEN action.payload ELSE '{}'
          END,
          '$.status'
        ) AS status,
        action.created_at
      FROM task_action action
      JOIN json_each(
        CASE WHEN json_valid(action.task_ids) THEN action.task_ids ELSE '[]' END
      ) task_ref ON CAST(task_ref.value AS TEXT)=?
      WHERE action.conversation_id=?
        AND action.created_at<=?
        AND json_extract(
          CASE WHEN json_valid(action.payload) THEN action.payload ELSE '{}'
          END,
          '$.status'
        ) IN ('proposed','ready','in_progress','blocked','in_review','done','cancelled')
      ORDER BY action.created_at DESC,action.id DESC
      LIMIT 1
    `).get(
      candidate.task_id,
      candidate.conversation_id,
      candidate.completed_at,
    ) as StatusAction | undefined;
  }

  private repair(candidate: ReconciliationCandidate, sourceAction: StatusAction): boolean {
    const expectedGraphRevision = taskGraphRepo.revision(candidate.conversation_id);
    const idempotencyKey = [
      'delivery-task-truth',
      candidate.delivery_run_id,
      candidate.task_id,
      sourceAction.id,
      `task-${candidate.revision}`,
      `graph-${expectedGraphRevision}`,
    ].join(':');
    const timestamp = this.now().toISOString();
    const result = taskGraphRepo.mutate({
      conversationId: candidate.conversation_id,
      expectedRevision: expectedGraphRevision,
      idempotencyKey,
      operation: 'reconcileCompletedDeliveryTaskProjection',
      request: {
        taskId: candidate.task_id,
        expectedTaskRevision: candidate.revision,
        expectedTaskStatus: candidate.status,
        deliveryRunId: candidate.delivery_run_id,
        deliveryCompletedAt: candidate.completed_at,
        sourceReviewActionId: sourceAction.id,
      },
      now: this.now(),
      execute: () => {
        const db = getDb();
        const transitionPath = reconciliationPath(candidate.status);
        if (transitionPath.length === 0) throw new StaleDeliveryTaskProjectionError();
        let expectedStatus = candidate.status;
        let expectedRevision = candidate.revision;
        for (const status of transitionPath) {
          if (!canTransitionTask(expectedStatus, status)) {
            throw new Error(`invalid_delivery_task_reconciliation_path:${expectedStatus}:${status}`);
          }
          const update = db.prepare(`
            UPDATE task
            SET status=?,revision=revision+1,updated_at=?
            WHERE id=? AND conversation_id=? AND status=? AND revision=?
          `).run(
            status,
            timestamp,
            candidate.task_id,
            candidate.conversation_id,
            expectedStatus,
            expectedRevision,
          );
          if (update.changes !== 1) throw new StaleDeliveryTaskProjectionError();
          expectedStatus = status;
          expectedRevision += 1;
        }

        const current = taskRepo.getById(candidate.task_id);
        if (!current) throw new StaleDeliveryTaskProjectionError();
        const proof = proofLogRepo.append({
          eventType: 'delivery.task_projection_reconciled',
          conversationId: candidate.conversation_id,
          taskId: candidate.task_id,
          agentId: candidate.agent_id || undefined,
          actorId: 'delivery-task-truth-reconciler',
          reasonCode: RECONCILIATION_REASON,
          metadata: {
            previousStatus: candidate.status,
            status: 'done',
            deliveryRunId: candidate.delivery_run_id,
            deliveryCompletedAt: candidate.completed_at,
            sourceReviewActionId: sourceAction.id,
            projectionTransitionPath: transitionPath,
          },
        });
        const action = taskGraphRepo.appendAction({
          conversationId: candidate.conversation_id,
          actorId: 'delivery-task-truth-reconciler',
          actorType: 'system',
          type: 'task.status_changed',
          taskIds: [candidate.task_id],
          proofEventId: proof.id,
          payload: {
            previousStatus: candidate.status,
            status: 'done',
            expectedTaskRevision: candidate.revision,
            reasonCode: RECONCILIATION_REASON,
            deliveryRunId: candidate.delivery_run_id,
            deliveryCompletedAt: candidate.completed_at,
            sourceReviewActionId: sourceAction.id,
            projectionTransitionPath: transitionPath,
          },
        });
        new DomainEventPublisher(db).publish({
          type: 'task.done',
          projectId: candidate.conversation_id,
          aggregate: { type: 'task', id: candidate.task_id, version: current.revision },
          actor: { type: 'system', id: 'delivery-task-truth-reconciler' },
          projectAgentId: candidate.agent_id || undefined,
          correlationId: candidate.delivery_run_id,
          causationId: sourceAction.id,
          dedupeKey: `delivery-task-truth:${candidate.delivery_run_id}:${candidate.task_id}:${current.revision}`,
          occurredAt: timestamp,
          payload: {
            previousStatus: 'in_review',
            status: 'done',
            agentId: candidate.agent_id,
            reconciledFromStatus: candidate.status,
            reasonCode: RECONCILIATION_REASON,
            deliveryRunId: candidate.delivery_run_id,
            sourceActionId: sourceAction.id,
          },
        });
        return {
          actionId: action.id,
          result: {
            task: current,
            action,
            proof,
          },
        };
      },
    });
    return (result.result.task as TaskRow).status === 'done';
  }

  private wasRevokedBeforeCompletion(
    candidate: ReconciliationCandidate,
    completionEvent: TaskCompletionEvent,
  ): boolean {
    return Boolean(getDb().prepare(`
      SELECT 1
      FROM platform_event
      WHERE stream_key=?
        AND category='domain'
        AND aggregate_type='task'
        AND aggregate_id=?
        AND type IN (
          'task.ready','task.in_progress','task.in_review','task.changes_requested',
          'task.blocked','task.cancelled'
        )
        AND stream_sequence>?
        AND occurred_at<=?
      LIMIT 1
    `).get(
      `task:${candidate.task_id}`,
      candidate.task_id,
      completionEvent.stream_sequence,
      candidate.completed_at,
    ));
  }

  private reviewedCompletionEvent(
    candidate: ReconciliationCandidate,
    sourceAction: StatusAction,
  ): TaskCompletionEvent | undefined {
    if (!sourceAction.proof_event_id) return undefined;
    return getDb().prepare(`
      SELECT stream_sequence
      FROM platform_event
      WHERE stream_key=?
        AND category='domain'
        AND aggregate_type='task'
        AND aggregate_id=?
        AND type='task.done'
        AND causation_id=?
        AND occurred_at<=?
      ORDER BY stream_sequence DESC
      LIMIT 1
    `).get(
      `task:${candidate.task_id}`,
      candidate.task_id,
      sourceAction.proof_event_id,
      candidate.completed_at,
    ) as TaskCompletionEvent | undefined;
  }

  private hasPassedReviewReceipt(
    candidate: ReconciliationCandidate,
    sourceAction: StatusAction,
  ): boolean {
    if (!sourceAction.proof_event_id) return false;
    return Boolean(getDb().prepare(`
      SELECT 1
      FROM platform_event event
      JOIN quality_gate gate
        ON gate.id=event.aggregate_id
       AND gate.conversation_id=event.project_id
      WHERE event.id=?
        AND event.type='gate.passed'
        AND event.project_id=?
        AND event.aggregate_type='quality_gate'
        AND event.subject_type='task'
        AND event.subject_id=?
        AND event.occurred_at<=?
        AND gate.kind='code_review'
        AND gate.target_type='task'
        AND gate.target_id=?
        AND gate.status='passed'
      LIMIT 1
    `).get(
      sourceAction.proof_event_id,
      candidate.conversation_id,
      candidate.task_id,
      candidate.completed_at,
      candidate.task_id,
    ));
  }
}
