import { taskGraphRepo } from '../repositories/task-graph-repo';
import type { TaskRow } from '../repositories/task-repo';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { qualityGateRepo } from './repository';
import type { QualityGateSnapshot } from './types';

/**
 * Creates the one revision-bound code-review gate for a Task. Both the
 * delivery controller and the durable Task router use this seam so replayed
 * task.in_review facts cannot produce a conflicting Gate definition.
 */
export function requestTaskCodeReviewGate(input: {
  task: TaskRow;
  actorId: string;
  correlationId?: string;
  causationId?: string;
  now?: Date;
}): QualityGateSnapshot {
  const existing = qualityGateRepo.find({
    kind: 'code_review',
    targetType: 'task',
    targetId: input.task.id,
    artifactRevision: String(input.task.revision),
  });
  // A gate created by an older controller is still the authority for this
  // exact artifact revision. Reuse it instead of conflicting on policy
  // metadata while a durable handler is being upgraded and replayed.
  if (existing) return existing;

  const pullRequestAction = taskGraphRepo.listActionsForTask(input.task.id)
    .filter((candidate) => candidate.type === 'task.pull_request_submitted')
    .at(-1);
  const pullRequestPayload = pullRequestAction
    ? JSON.parse(pullRequestAction.payload) as {
        receipt?: { headSha?: string };
        artifactRevision?: string;
      }
    : undefined;
  const audience = resolveTaskNotificationAudience(input.task.conversation_id);
  const authorizedEvaluatorIds = audience.reviewGateAgentIds
    .filter((agentId) => agentId !== input.task.agent_id);
  const providerBacked = pullRequestPayload?.artifactRevision === String(input.task.revision)
    && Boolean(pullRequestPayload.receipt?.headSha);

  return qualityGateRepo.request({
    conversationId: input.task.conversation_id,
    kind: 'code_review',
    targetType: 'task',
    targetId: input.task.id,
    artifactRevision: String(input.task.revision),
    criteria: providerBacked
      ? {
          providerReviewRequired: true,
          qualityDecision: 'pass',
          maxBlockerCount: 0,
          providerHeadSha: pullRequestPayload?.receipt?.headSha,
        }
      : { taskStatus: input.task.status, requiresIndependentReview: true },
    policy: {
      source: 'task_review_transition',
      prohibitSelfReview: true,
      implementerId: input.task.agent_id,
      authorizedEvaluatorIds,
    },
    actor: { type: 'system', id: input.actorId },
    correlationId: input.correlationId,
    causationId: input.causationId,
    now: input.now,
  });
}
