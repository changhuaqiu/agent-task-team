import { getDb } from '../db';
import { requestTaskCodeReviewGate } from '../quality-gate/task-code-review-gate';
import { taskRepo } from '../repositories/task-repo';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { buildWorkIdentity } from '../work-contract/work-identity';
import {
  CollaborationEventRouter,
  CollaborationKernel,
} from '../collaboration-kernel';
import type { PlatformEventHandler } from './dispatcher';

export interface TaskWakeupRouterOptions {
  collaboration?: CollaborationKernel;
}

/**
 * Converts current task facts into durable agent commands. Historical events
 * are checked against the current task row so recovery cannot revive work that
 * has already advanced or reached a terminal state.
 */
export class TaskWakeupRouter {
  private readonly collaboration: CollaborationKernel;
  private readonly router: CollaborationEventRouter;

  constructor(options: TaskWakeupRouterOptions = {}) {
    this.collaboration = options.collaboration ?? new CollaborationKernel();
    this.router = new CollaborationEventRouter({
      kernel: this.collaboration,
      resolve: (event) => {
        if (event.type === 'task.in_review') {
          const task = taskRepo.getById(event.aggregate.id);
          if (
            !task
            || task.conversation_id !== event.projectId
            || task.status !== 'in_review'
          ) return undefined;
          const gate = requestTaskCodeReviewGate({
            task,
            actorId: 'task-review-gate-router',
            correlationId: event.correlationId,
            causationId: event.eventId,
            now: new Date(event.occurredAt),
          });
          const deliveryOwned = Boolean(getDb().prepare(`
            SELECT 1 FROM autonomous_delivery_run
            WHERE conversation_id=? AND status NOT IN ('completed','failed','cancelled')
            LIMIT 1
          `).get(task.conversation_id));
          // Active Delivery owns dispatch. Its gate.requested handler will
          // schedule the reviewer from the same durable Gate fact.
          if (deliveryOwned) return undefined;
          const reviewerId = resolveTaskNotificationAudience(task.conversation_id)
            .reviewGateAgentIds.find((agentId) => agentId !== task.agent_id);
          if (!reviewerId) throw new Error(`task_review_gate_reviewer_missing:${task.id}`);
          return {
            targetAgentId: reviewerId,
            source: 'review_gate',
            requestedAction: [
              `Review task ${task.id}「${task.title}」 at revision ${task.revision}.`,
              `Quality Gate: ${gate.gate.id}.`,
              'Submit exactly one structured record_gate_decision AgentOutcome.',
              'Its payload must contain the exact gateId above, decision as passed | changes_requested | rejected, evidenceType, and evidence.',
            ].join(' '),
            idempotencyKey: `task:${task.id}:review:${task.revision}`,
            scope: {
              taskId: task.id,
              workId: buildWorkIdentity({
                scope: 'task',
                targetId: task.id,
                agentId: reviewerId,
                gateId: gate.gate.id,
                purpose: 'review',
              }),
            },
            context: { scenario: 'code_review' },
            replyTo: { type: 'quality_gate', id: gate.gate.id },
          };
        }
        if (event.type !== 'task.changes_requested') return undefined;
        const payload = event.payload as {
          agentId?: string;
          reviewNote?: string;
          status?: string;
        };
        const task = taskRepo.getById(event.aggregate.id);
        if (
          !task
          || task.conversation_id !== event.projectId
          || task.status !== payload.status
          || task.agent_id !== payload.agentId
        ) return undefined;
        return {
          targetAgentId: task.agent_id,
          source: 'workflow',
          requestedAction: `Task ${task.id} requires changes. Address the review feedback: ${payload.reviewNote ?? 'Review the latest task evidence and correct the implementation.'}`,
          idempotencyKey: `task:${task.id}:changes:${event.aggregate.version ?? event.eventId}`,
          scope: { taskId: task.id },
          replyTo: { type: 'task', id: task.id },
        };
      },
    });
  }

  readonly handle: PlatformEventHandler = (event, context) => {
    if (event.category !== 'domain' || !event.type.startsWith('task.')) return;
    if (context.signal.aborted) {
      throw context.signal.reason ?? new Error('task_wakeup_router_aborted');
    }
    if (event.type === 'task.done' || event.type === 'task.cancelled') {
      this.collaboration.cancel({
        kind: 'task',
        projectId: event.projectId,
        taskId: event.aggregate.id,
      });
      return;
    }
    return this.router.handle(event, context);
  };
}
