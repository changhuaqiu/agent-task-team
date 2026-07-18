import type {
  EngineeringCollaborationCard,
  ImplementationEvidence,
  PullRequestReceipt,
  ReviewEvidence,
  ReviewReceipt,
} from '@/lib/engineering-collaboration/types';
import { getDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { messageRepo } from '../repositories/message-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo, type TaskActionRow } from '../repositories/task-graph-repo';
import { taskRepo, type TaskRow } from '../repositories/task-repo';
import { publishTaskChangeNotification, resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import type { GitProviderVerifier } from './git-provider';

export type EngineeringCollaborationReasonCode =
  | 'task_not_found'
  | 'task_actor_mismatch'
  | 'task_not_reviewable'
  | 'pull_request_not_open'
  | 'pull_request_receipt_missing'
  | 'pull_request_head_changed'
  | 'review_actor_not_allowed'
  | 'review_actor_matches_implementer'
  | 'review_receipt_mismatch';

export class EngineeringCollaborationError extends Error {
  constructor(public readonly reasonCode: EngineeringCollaborationReasonCode, message: string) {
    super(message);
    this.name = 'EngineeringCollaborationError';
  }
}

function parsePayload(action: TaskActionRow): Record<string, unknown> {
  try {
    const value = JSON.parse(action.payload);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function assertTask(taskId: string): TaskRow {
  const task = taskRepo.getById(taskId);
  if (!task) throw new EngineeringCollaborationError('task_not_found', `Task not found: ${taskId}`);
  return task;
}

function latestPullRequestAction(taskId: string): TaskActionRow | undefined {
  return taskGraphRepo.listActionsForTask(taskId)
    .filter((action) => action.type === 'task.pull_request_submitted')
    .at(-1);
}

function appendCardMessage(input: {
  task: TaskRow;
  actorAgentId: string;
  content: string;
  card: EngineeringCollaborationCard;
  action: TaskActionRow;
}): string {
  const messageId = messageRepo.append({
    conversationId: input.task.conversation_id,
    taskId: input.task.id,
    senderType: 'agent',
    senderId: input.actorAgentId,
    content: input.content,
    intent: input.card.kind === 'review' ? 'review' : 'progress',
    metadata: {
      collaborationCard: input.card,
      taskActionIds: [input.action.id],
    },
  });
  taskGraphRepo.bindMessage({
    conversationId: input.task.conversation_id,
    messageId,
    taskId: input.task.id,
    actionId: input.action.id,
  });
  return messageId;
}

export class EngineeringCollaborationService {
  constructor(private readonly verifier: GitProviderVerifier) {}

  async recordPullRequest(input: {
    taskId: string;
    actorAgentId: string;
    pullRequestUrl: string;
    evidence: ImplementationEvidence;
  }): Promise<{ receipt: PullRequestReceipt; card: EngineeringCollaborationCard; messageId: string }> {
    const task = assertTask(input.taskId);
    if (task.agent_id !== input.actorAgentId) {
      throw new EngineeringCollaborationError('task_actor_mismatch', 'Only the task implementer can submit its pull request');
    }
    if (!['in_progress', 'rejected'].includes(task.status)) {
      throw new EngineeringCollaborationError('task_not_reviewable', `Task ${task.id} is not ready for pull request submission from ${task.status}`);
    }
    const conversation = conversationRepo.getById(task.conversation_id);
    const cwd = conversation?.git_repo_root ?? conversation?.project_path ?? undefined;
    const receipt = await this.verifier.getPullRequest({ url: input.pullRequestUrl, cwd });
    if (receipt.state !== 'open') {
      throw new EngineeringCollaborationError('pull_request_not_open', `Pull request #${receipt.number} is ${receipt.state}`);
    }

    const previousTask = task;
    const result = getDb().transaction(() => {
      const action = taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: input.actorAgentId,
        actorType: 'agent',
        type: 'task.pull_request_submitted',
        taskIds: [task.id],
        payload: { receipt, evidence: input.evidence },
      });
      taskGraphRepo.addArtifact({
        conversationId: task.conversation_id,
        taskId: task.id,
        kind: 'pull_request',
        label: `${receipt.repository}#${receipt.number}`,
        url: receipt.url,
        createdByActionId: action.id,
      });
      const card: EngineeringCollaborationCard = {
        version: 1,
        kind: 'pull_request',
        taskId: task.id,
        actorAgentId: input.actorAgentId,
        createdAt: new Date().toISOString(),
        receipt,
        evidence: input.evidence,
      };
      const messageId = appendCardMessage({
        task,
        actorAgentId: input.actorAgentId,
        content: `已提交 ${task.id} 的开发交付：${receipt.repository}#${receipt.number}。`,
        card,
        action,
      });
      taskRepo.updateStatus(task.id, 'in_review');
      proofLogRepo.append({
        eventType: 'engineering.pull_request.verified',
        conversationId: task.conversation_id,
        taskId: task.id,
        actorId: input.actorAgentId,
        metadata: { repository: receipt.repository, number: receipt.number, headSha: receipt.headSha, actionId: action.id },
      });
      return { card, messageId };
    })();
    const updatedTask = taskRepo.getById(task.id)!;
    publishTaskChangeNotification({
      kind: 'task.status_changed',
      task: updatedTask,
      previousTask,
      actorId: input.actorAgentId,
      actorType: 'agent',
      changedFields: ['status'],
    });
    return { receipt, ...result };
  }

  async recordReview(input: {
    taskId: string;
    actorAgentId: string;
    pullRequestUrl: string;
    reviewUrl: string;
    evidence: ReviewEvidence;
  }): Promise<{ receipt: ReviewReceipt; card: EngineeringCollaborationCard; messageId: string }> {
    const task = assertTask(input.taskId);
    if (task.status !== 'in_review') {
      throw new EngineeringCollaborationError('task_not_reviewable', `Task ${task.id} is not in review`);
    }
    const audience = resolveTaskNotificationAudience(task.conversation_id);
    if (!audience.reviewGateAgentIds.includes(input.actorAgentId)) {
      throw new EngineeringCollaborationError('review_actor_not_allowed', `${input.actorAgentId} is not the configured quality gate owner`);
    }
    if (task.agent_id === input.actorAgentId) {
      throw new EngineeringCollaborationError('review_actor_matches_implementer', 'The implementer cannot review their own task');
    }
    const pullRequestAction = latestPullRequestAction(task.id);
    if (!pullRequestAction) {
      throw new EngineeringCollaborationError('pull_request_receipt_missing', 'A verified pull request receipt is required before review');
    }
    const pullRequestPayload = parsePayload(pullRequestAction);
    const pullRequest = pullRequestPayload.receipt as PullRequestReceipt | undefined;
    if (!pullRequest?.headSha || pullRequest.url !== input.pullRequestUrl) {
      throw new EngineeringCollaborationError('review_receipt_mismatch', 'Review does not match the task pull request receipt');
    }
    const conversation = conversationRepo.getById(task.conversation_id);
    const cwd = conversation?.git_repo_root ?? conversation?.project_path ?? undefined;
    const receipt = await this.verifier.getReview({
      pullRequestUrl: input.pullRequestUrl,
      reviewUrl: input.reviewUrl,
      cwd,
    });
    if (receipt.pullRequestUrl !== pullRequest.url || receipt.pullRequestNumber !== pullRequest.number) {
      throw new EngineeringCollaborationError('review_receipt_mismatch', 'Provider review belongs to a different pull request');
    }
    if (receipt.headSha !== pullRequest.headSha) {
      throw new EngineeringCollaborationError('pull_request_head_changed', 'The pull request head changed after the delivery receipt');
    }

    const previousTask = task;
    const result = getDb().transaction(() => {
      const action = taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: input.actorAgentId,
        actorType: 'agent',
        type: 'task.review_recorded',
        taskIds: [task.id],
        payload: { receipt, evidence: input.evidence, pullRequestActionId: pullRequestAction.id },
      });
      taskGraphRepo.addArtifact({
        conversationId: task.conversation_id,
        taskId: task.id,
        kind: 'review',
        label: `${receipt.decision} by ${input.actorAgentId}`,
        url: receipt.reviewUrl,
        createdByActionId: action.id,
      });
      const card: EngineeringCollaborationCard = {
        version: 1,
        kind: 'review',
        taskId: task.id,
        actorAgentId: input.actorAgentId,
        createdAt: new Date().toISOString(),
        receipt,
        evidence: input.evidence,
      };
      const messageId = appendCardMessage({
        task,
        actorAgentId: input.actorAgentId,
        content: `已在 PR #${receipt.pullRequestNumber} 留下真实评审：${receipt.decision}。`,
        card,
        action,
      });
      if (receipt.decision === 'changes_requested') {
        taskRepo.updateStatus(task.id, 'rejected', input.evidence.summary);
      } else {
        taskRepo.update(task.id, { review_note: input.evidence.summary });
      }
      proofLogRepo.append({
        eventType: 'engineering.review.verified',
        conversationId: task.conversation_id,
        taskId: task.id,
        actorId: input.actorAgentId,
        metadata: { reviewId: receipt.reviewId, headSha: receipt.headSha, decision: receipt.decision, actionId: action.id },
      });
      return { card, messageId };
    })();
    const updatedTask = taskRepo.getById(task.id)!;
    publishTaskChangeNotification({
      kind: 'task.status_changed',
      task: updatedTask,
      previousTask,
      actorId: input.actorAgentId,
      actorType: 'agent',
      changedFields: receipt.decision === 'changes_requested' ? ['status', 'review_note'] : ['review_note'],
    });
    return { receipt, ...result };
  }
}
