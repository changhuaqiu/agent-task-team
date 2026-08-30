import { getDb } from '../db';
import { qualityGateRepo } from '../quality-gate/repository';
import { requestTaskCodeReviewGate } from '../quality-gate/task-code-review-gate';
import { taskRepo } from '../repositories/task-repo';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { workContractRepo } from '../work-contract/repository';
import type { WorkAuthorityRow } from '../work-contract/types';
import { buildWorkIdentity, parseWorkIdentity } from '../work-contract/work-identity';
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
        if (event.type === 'task.in_review' || event.type === 'task.updated') {
          const task = taskRepo.getById(event.aggregate.id);
          if (
            !task
            || task.conversation_id !== event.projectId
            || task.status !== 'in_review'
            || (event.type === 'task.updated' && task.revision !== event.aggregate.version)
          ) return undefined;
          const deliveryOwned = Boolean(getDb().prepare(`
            SELECT 1 FROM autonomous_delivery_run
            WHERE conversation_id=? AND status NOT IN ('completed','failed','cancelled')
            LIMIT 1
          `).get(task.conversation_id));
          const reviewerId = resolveTaskNotificationAudience(task.conversation_id)
            .reviewGateAgentIds.find((agentId) => agentId !== task.agent_id);
          if (!deliveryOwned && !reviewerId) {
            throw new Error(`task_review_gate_reviewer_missing:${task.id}`);
          }
          const gate = getDb().transaction(() => {
            // Reconcile on every replay, even when the current Gate already
            // exists. A stale reviewer can be admitted after an earlier scan;
            // keeping cleanup and replacement Gate creation under one write
            // lock makes either the cleanup or contract issuance observe the
            // other's durable result.
            this.supersedeStaleReviewWork(
              task.id,
              task.conversation_id,
              task.revision,
              event,
            );
            return qualityGateRepo.find({
              kind: 'code_review',
              targetType: 'task',
              targetId: task.id,
              artifactRevision: String(task.revision),
            }) ?? requestTaskCodeReviewGate({
              task,
              actorId: 'task-review-gate-router',
              correlationId: event.correlationId,
              causationId: event.eventId,
              now: new Date(event.occurredAt),
            });
          }).immediate();
          // Active Delivery owns dispatch. Its gate.requested handler will
          // schedule the reviewer from the same durable Gate fact.
          if (deliveryOwned) return undefined;
          const idempotencyKey = `task:${task.id}:review:${task.revision}`;
          if (this.reviewDispatchExists(task.conversation_id, reviewerId!, idempotencyKey)) {
            return undefined;
          }
          return {
            targetAgentId: reviewerId!,
            source: 'review_gate',
            requestedAction: [
              `Review task ${task.id}「${task.title}」 at revision ${task.revision}.`,
              `Quality Gate: ${gate.gate.id}.`,
              'Submit exactly one structured record_gate_decision AgentOutcome.',
              'Its payload must contain the exact gateId above, decision as passed | changes_requested | rejected, evidenceType, and evidence.',
            ].join(' '),
            idempotencyKey,
            scope: {
              taskId: task.id,
              workId: buildWorkIdentity({
                scope: 'task',
                targetId: task.id,
                agentId: reviewerId!,
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

  private reviewDispatchExists(
    projectId: string,
    reviewerId: string,
    idempotencyKey: string,
  ): boolean {
    return Boolean(getDb().prepare(`
      SELECT 1 FROM agent_inbox_item
      WHERE project_id=? AND project_agent_id=? AND idempotency_key=?
      LIMIT 1
    `).get(projectId, reviewerId, idempotencyKey));
  }

  private supersedeStaleReviewWork(
    taskId: string,
    projectId: string,
    currentRevision: number,
    event: Parameters<PlatformEventHandler>[0],
  ): void {
    const staleGates = qualityGateRepo.listForTarget('task', taskId)
      .filter((gate) => (
        gate.kind === 'code_review'
        && gate.artifact_revision !== String(currentRevision)
      ));
    if (staleGates.length === 0) return;
    const staleGateIds = new Set(staleGates.map((gate) => gate.id));
    const db = getDb();
    const authorities = db.prepare(`
      SELECT authority.* FROM work_authority authority
      JOIN work_contract contract ON contract.id=authority.current_contract_id
      WHERE contract.task_id=? AND authority.status='active'
    `).all(taskId) as WorkAuthorityRow[];
    const pendingRows = db.prepare(`
      SELECT command_json FROM agent_inbox_item
      WHERE project_id=? AND status IN ('enqueued','released','claimed')
    `).all(projectId) as Array<{ command_json: string }>;
    const staleWorkIds = new Set<string>();
    for (const authority of authorities) {
      if (staleGateIds.has(parseWorkIdentity(authority.work_id)?.gateId ?? '')) {
        staleWorkIds.add(authority.work_id);
        workContractRepo.close({
          workId: authority.work_id,
          expectedEpoch: authority.current_epoch,
          correlationId: event.correlationId,
          causationId: event.eventId,
        });
      }
    }
    for (const row of pendingRows) {
      const command = JSON.parse(row.command_json) as { workId?: string };
      if (staleGateIds.has(parseWorkIdentity(command.workId)?.gateId ?? '') && command.workId) {
        staleWorkIds.add(command.workId);
      }
    }
    this.collaboration.cancel({
      kind: 'work',
      projectId,
      workIds: [...staleWorkIds],
      reasonCode: 'task_review_artifact_superseded',
    });
    for (const gate of staleGates.filter((candidate) => (
      candidate.status === 'requested' || candidate.status === 'evaluating'
    ))) {
      qualityGateRepo.cancel({
        gateId: gate.id,
        actor: { type: 'system', id: 'task-review-gate-router' },
        reason: 'task_review_artifact_superseded',
        expectedRevision: gate.revision,
        correlationId: event.correlationId,
        causationId: event.eventId,
        now: new Date(event.occurredAt),
      });
    }
  }
}
