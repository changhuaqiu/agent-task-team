import type {
  EngineeringCollaborationCard,
  ImplementationEvidence,
  MergeEvidence,
  MergeReceipt,
  PullRequestReceipt,
  ReviewEvidence,
  ReviewReceipt,
} from '@/lib/engineering-collaboration/types';
import type { Server as IOServer } from 'socket.io';
import { getDb } from '../db';
import { conversationRepo } from '../repositories/conversation-repo';
import { messageRepo } from '../repositories/message-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo, type TaskActionRow } from '../repositories/task-graph-repo';
import { taskRepo, type TaskRow } from '../repositories/task-repo';
import { publishTaskChangeNotification, resolveTaskNotificationAudience, type PublishTaskChangeNotificationInput } from '../task-flow/task-notification-publisher';
import type { GitProviderVerifier } from './git-provider';

export type EngineeringCollaborationReasonCode =
  | 'task_not_found'
  | 'task_conversation_mismatch'
  | 'task_actor_mismatch'
  | 'task_not_reviewable'
  | 'pull_request_not_open'
  | 'pull_request_receipt_missing'
  | 'pull_request_head_changed'
  | 'review_actor_not_allowed'
  | 'review_actor_matches_implementer'
  | 'review_receipt_mismatch'
  | 'merge_actor_not_allowed'
  | 'merge_receipt_mismatch'
  | 'review_approval_missing'
  | 'repository_context_missing'
  | 'pull_request_checks_failed';

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

function assertConversation(task: TaskRow, expectedConversationId: string | undefined): void {
  if (expectedConversationId !== undefined && task.conversation_id !== expectedConversationId) {
    throw new EngineeringCollaborationError('task_conversation_mismatch', `Task ${task.id} does not belong to the invoking conversation`);
  }
}

function gitRepoRoot(task: TaskRow): string {
  const root = conversationRepo.getById(task.conversation_id)?.git_repo_root?.trim();
  if (!root) {
    throw new EngineeringCollaborationError('repository_context_missing', 'The conversation must configure an authoritative Git repository before recording collaboration receipts');
  }
  return root;
}

function latestReviewAction(taskId: string): TaskActionRow | undefined {
  return taskGraphRepo.listActionsForTask(taskId)
    .filter((action) => action.type === 'task.review_recorded')
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

function publishAfterCommit(io: IOServer | undefined, input: PublishTaskChangeNotificationInput): void {
  try {
    publishTaskChangeNotification({ ...input, io });
  } catch (error) {
    console.error('[engineering-collaboration] notification failed after receipt commit', error);
    try {
      proofLogRepo.append({
        eventType: 'engineering.notification.failed',
        conversationId: input.task.conversation_id,
        taskId: input.task.id,
        actorId: input.actorId,
        reasonCode: 'notification_delivery_failed',
        metadata: { kind: input.kind },
      });
    } catch (proofError) {
      console.error('[engineering-collaboration] failed to persist notification failure proof', proofError);
    }
  }
}

export class EngineeringCollaborationService {
  constructor(private readonly verifier: GitProviderVerifier, private readonly io?: IOServer) {}

  async recordPullRequest(input: {
    taskId: string;
    expectedConversationId?: string;
    actorAgentId: string;
    pullRequestUrl: string;
    evidence: ImplementationEvidence;
  }): Promise<{ receipt: PullRequestReceipt; card: EngineeringCollaborationCard; messageId: string }> {
    const task = assertTask(input.taskId);
    assertConversation(task, input.expectedConversationId);
    if (task.agent_id !== input.actorAgentId) {
      throw new EngineeringCollaborationError('task_actor_mismatch', 'Only the task implementer can submit its pull request');
    }
    if (!['in_progress', 'in_review', 'rejected'].includes(task.status)) {
      throw new EngineeringCollaborationError('task_not_reviewable', `Task ${task.id} is not ready for pull request submission from ${task.status}`);
    }
    const cwd = gitRepoRoot(task);
    const receipt = await this.verifier.getPullRequest({ url: input.pullRequestUrl, cwd });
    if (receipt.state !== 'open') {
      throw new EngineeringCollaborationError('pull_request_not_open', `Pull request #${receipt.number} is ${receipt.state}`);
    }
    if (receipt.checks === 'failing') {
      throw new EngineeringCollaborationError('pull_request_checks_failed', `Pull request #${receipt.number} has failing checks`);
    }
    const previousPullRequestAction = latestPullRequestAction(task.id);
    const previousPullRequestPayload = previousPullRequestAction ? parsePayload(previousPullRequestAction) : undefined;
    const previousPullRequest = previousPullRequestPayload?.receipt as PullRequestReceipt | undefined;
    if (task.status === 'in_review') {
      if (!previousPullRequest || previousPullRequest.url !== receipt.url) {
        throw new EngineeringCollaborationError('review_receipt_mismatch', 'An in-review task must keep using its verified pull request');
      }
      if (previousPullRequest.headSha === receipt.headSha) {
        throw new EngineeringCollaborationError('task_not_reviewable', 'The pull request head has not changed');
      }
    }
    const previousReviewAction = latestReviewAction(task.id);
    const previousReviewPayload = previousReviewAction ? parsePayload(previousReviewAction) : undefined;
    const previousReview = previousReviewPayload?.receipt as ReviewReceipt | undefined;
    const previousReviewEvidence = previousReviewPayload?.evidence as ReviewEvidence | undefined;

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
      if (previousReview && previousReviewEvidence && previousReview.headSha !== receipt.headSha) {
        const staleCard: EngineeringCollaborationCard = {
          version: 1,
          kind: 'review',
          taskId: task.id,
          actorAgentId: previousReviewAction?.actor_id ?? 'reviewer',
          createdAt: new Date().toISOString(),
          receipt: previousReview,
          evidence: previousReviewEvidence,
          stale: true,
        };
        appendCardMessage({
          task,
          actorAgentId: staleCard.actorAgentId,
          content: `PR #${receipt.number} 已有新提交，上一轮评审需要对 ${receipt.headSha.slice(0, 12)} 重新执行。`,
          card: staleCard,
          action,
        });
      }
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
    publishAfterCommit(this.io, {
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
    expectedConversationId?: string;
    actorAgentId: string;
    pullRequestUrl: string;
    reviewUrl: string;
    evidence: ReviewEvidence;
  }): Promise<{ receipt: ReviewReceipt; card: EngineeringCollaborationCard; messageId: string }> {
    const task = assertTask(input.taskId);
    assertConversation(task, input.expectedConversationId);
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
    const cwd = gitRepoRoot(task);
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
      if (receipt.decision === 'changes_requested' || input.evidence.qualityDecision === 'reject') {
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
    publishAfterCommit(this.io, {
      kind: 'task.status_changed',
      task: updatedTask,
      previousTask,
      actorId: input.actorAgentId,
      actorType: 'agent',
      changedFields: receipt.decision === 'changes_requested' || input.evidence.qualityDecision === 'reject' ? ['status', 'review_note'] : ['review_note'],
    });
    return { receipt, ...result };
  }

  async recordMerge(input: {
    taskId: string;
    expectedConversationId?: string;
    actorAgentId: string;
    pullRequestUrl: string;
    evidence: MergeEvidence;
  }): Promise<{ receipt: MergeReceipt; card: EngineeringCollaborationCard; messageId: string }> {
    const task = assertTask(input.taskId);
    assertConversation(task, input.expectedConversationId);
    if (task.status !== 'in_review') {
      throw new EngineeringCollaborationError('task_not_reviewable', `Task ${task.id} is not awaiting merge`);
    }
    const audience = resolveTaskNotificationAudience(task.conversation_id);
    if (!audience.coordinatorAgentIds.includes(input.actorAgentId)) {
      throw new EngineeringCollaborationError('merge_actor_not_allowed', `${input.actorAgentId} is not the configured coordinator`);
    }
    const pullRequestAction = latestPullRequestAction(task.id);
    const reviewAction = latestReviewAction(task.id);
    if (!pullRequestAction) {
      throw new EngineeringCollaborationError('pull_request_receipt_missing', 'A verified pull request receipt is required before merge closure');
    }
    const pullRequest = parsePayload(pullRequestAction).receipt as PullRequestReceipt | undefined;
    const reviewPayload = reviewAction ? parsePayload(reviewAction) : undefined;
    const review = reviewPayload?.receipt as ReviewReceipt | undefined;
    const reviewEvidence = reviewPayload?.evidence as ReviewEvidence | undefined;
    if (!pullRequest || pullRequest.url !== input.pullRequestUrl) {
      throw new EngineeringCollaborationError('merge_receipt_mismatch', 'Merge does not match the task pull request receipt');
    }
    if (!review || review.headSha !== pullRequest.headSha || review.decision === 'changes_requested' || reviewEvidence?.qualityDecision !== 'pass' || (reviewEvidence?.blockerCount ?? 1) > 0) {
      throw new EngineeringCollaborationError('review_approval_missing', 'A current provider-backed review with zero blockers is required before merge closure');
    }
    const cwd = gitRepoRoot(task);
    const receipt = await this.verifier.getMerge({ pullRequestUrl: input.pullRequestUrl, cwd });
    if (receipt.pullRequestUrl !== pullRequest.url || receipt.pullRequestNumber !== pullRequest.number || receipt.headSha !== pullRequest.headSha) {
      throw new EngineeringCollaborationError('merge_receipt_mismatch', 'Provider merge receipt does not match the current pull request head');
    }

    const previousTask = task;
    const result = getDb().transaction(() => {
      const action = taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: input.actorAgentId,
        actorType: 'agent',
        type: 'task.pull_request_merged',
        taskIds: [task.id],
        payload: { receipt, evidence: input.evidence, pullRequestActionId: pullRequestAction.id, reviewActionId: reviewAction?.id },
      });
      taskGraphRepo.addArtifact({
        conversationId: task.conversation_id,
        taskId: task.id,
        kind: 'merge',
        label: `merged ${receipt.mergeSha.slice(0, 12)} to ${receipt.baseRef}`,
        url: receipt.pullRequestUrl,
        createdByActionId: action.id,
      });
      const card: EngineeringCollaborationCard = {
        version: 1,
        kind: 'merge',
        taskId: task.id,
        actorAgentId: input.actorAgentId,
        createdAt: new Date().toISOString(),
        receipt,
        evidence: input.evidence,
      };
      const messageId = appendCardMessage({
        task,
        actorAgentId: input.actorAgentId,
        content: `${task.id} 已合并到 ${receipt.baseRef} 并完成主分支复验。`,
        card,
        action,
      });
      taskRepo.updateStatus(task.id, 'done');
      proofLogRepo.append({
        eventType: 'engineering.merge.verified',
        conversationId: task.conversation_id,
        taskId: task.id,
        actorId: input.actorAgentId,
        metadata: { mergeSha: receipt.mergeSha, headSha: receipt.headSha, actionId: action.id },
      });
      return { card, messageId };
    })();
    const updatedTask = taskRepo.getById(task.id)!;
    publishAfterCommit(this.io, {
      kind: 'task.status_changed',
      task: updatedTask,
      previousTask,
      actorId: input.actorAgentId,
      actorType: 'agent',
      changedFields: ['status'],
    });
    return { receipt, ...result };
  }
}
