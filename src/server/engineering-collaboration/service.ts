import type {
  EngineeringCollaborationCard,
  ImplementationEvidence,
  MergeEvidence,
  MergeReceipt,
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
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import type { GitProviderVerifier } from './git-provider';
import { qualityGateRepo } from '../quality-gate/repository';
import { evaluateTaskStatusEvidenceGate } from '../task-flow/task-gate-evidence';

export type EngineeringCollaborationReasonCode =
  | 'task_not_found'
  | 'task_conversation_mismatch'
  | 'task_actor_mismatch'
  | 'task_not_reviewable'
  | 'pull_request_not_open'
  | 'pull_request_changed'
  | 'pull_request_head_unchanged'
  | 'pull_request_receipt_missing'
  | 'pull_request_head_changed'
  | 'review_actor_not_allowed'
  | 'review_actor_matches_implementer'
  | 'review_receipt_mismatch'
  | 'merge_actor_not_allowed'
  | 'merge_receipt_mismatch'
  | 'review_approval_missing'
  | 'quality_gate_missing'
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
    .filter((action) => action.type === 'task.provider_review_received')
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
    if (!['in_progress', 'in_review'].includes(task.status)) {
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
    if (task.status === 'in_review' || previousPullRequest) {
      if (!previousPullRequest) {
        throw new EngineeringCollaborationError('review_receipt_mismatch', 'An in-review task must keep using its verified pull request');
      }
      if (previousPullRequest.url !== receipt.url) {
        throw new EngineeringCollaborationError('pull_request_changed', 'Rework or in-review work must keep using its verified pull request');
      }
      if (previousPullRequest.headSha === receipt.headSha) {
        throw new EngineeringCollaborationError('pull_request_head_unchanged', 'The pull request head has not changed');
      }
    }
    const previousReviewAction = latestReviewAction(task.id);
    const previousReviewPayload = previousReviewAction ? parsePayload(previousReviewAction) : undefined;
    const previousReview = previousReviewPayload?.receipt as ReviewReceipt | undefined;
    const previousReviewEvidence = previousReviewPayload?.evidence as ReviewEvidence | undefined;
    const reviewAudience = resolveTaskNotificationAudience(task.conversation_id);

    const result = getDb().transaction(() => {
      let reviewableTask = taskRepo.getById(task.id)!;
      if (reviewableTask.status === 'in_review') {
        const supersededGate = qualityGateRepo.find({
          kind: 'code_review',
          targetType: 'task',
          targetId: task.id,
          artifactRevision: String(reviewableTask.revision),
        });
        if (
          supersededGate
          && (
            supersededGate.gate.status === 'requested'
            || supersededGate.gate.status === 'evaluating'
          )
        ) {
          qualityGateRepo.cancel({
            gateId: supersededGate.gate.id,
            actor: { type: 'agent', id: input.actorAgentId },
            reason: `artifact_superseded:${receipt.headSha}`,
            expectedRevision: supersededGate.gate.revision,
          });
        }
        reviewableTask = taskRepo.transition(task.id, {
          to: 'in_progress',
          expectedFrom: 'in_review',
          expectedRevision: reviewableTask.revision,
          reviewNote: 'A new provider artifact superseded the pending review.',
        })!;
      }
      const readinessGate = evaluateTaskStatusEvidenceGate({
        task: reviewableTask,
        nextStatus: 'in_review',
        evidence: input.evidence,
        actorId: input.actorAgentId,
        pullRequestRequired: true,
        verifiedPullRequest: true,
      });
      if (!readinessGate.allowed) {
        throw new EngineeringCollaborationError(
          'pull_request_receipt_missing',
          readinessGate.message ?? 'Implementation readiness gate rejected the pull request',
        );
      }
      reviewableTask = taskRepo.transition(task.id, {
        to: 'in_review',
        expectedFrom: 'in_progress',
        expectedRevision: reviewableTask.revision,
      })!;
      const gate = qualityGateRepo.request({
        conversationId: task.conversation_id,
        kind: 'code_review',
        targetType: 'task',
        targetId: task.id,
        artifactRevision: String(reviewableTask.revision),
        criteria: {
          providerReviewRequired: true,
          qualityDecision: 'pass',
          maxBlockerCount: 0,
          providerHeadSha: receipt.headSha,
        },
        policy: {
          prohibitSelfReview: true,
          implementerId: task.agent_id,
          authorizedEvaluatorIds: reviewAudience.reviewGateAgentIds,
        },
        actor: { type: 'agent', id: input.actorAgentId },
      });
      const action = taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: input.actorAgentId,
        actorType: 'agent',
        type: 'task.pull_request_submitted',
        taskIds: [task.id],
        payload: {
          receipt,
          evidence: input.evidence,
          gateId: gate.gate.id,
          artifactRevision: gate.gate.artifact_revision,
        },
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
      proofLogRepo.append({
        eventType: 'engineering.pull_request.verified',
        conversationId: task.conversation_id,
        taskId: task.id,
        actorId: input.actorAgentId,
        metadata: { repository: receipt.repository, number: receipt.number, headSha: receipt.headSha, actionId: action.id },
      });
      return { card, messageId };
    })();
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
    const gateId = typeof pullRequestPayload.gateId === 'string'
      ? pullRequestPayload.gateId
      : undefined;
    const gate = gateId ? qualityGateRepo.getSnapshot(gateId) : undefined;
    if (
      !gate
      || gate.gate.kind !== 'code_review'
      || gate.gate.target_type !== 'task'
      || gate.gate.target_id !== task.id
      || gate.gate.artifact_revision !== String(task.revision)
    ) {
      throw new EngineeringCollaborationError(
        'quality_gate_missing',
        `No current code review gate exists for ${task.id}@revision-${task.revision}`,
      );
    }

    const result = getDb().transaction(() => {
      const action = taskGraphRepo.appendAction({
        conversationId: task.conversation_id,
        actorId: input.actorAgentId,
        actorType: 'agent',
        type: 'task.provider_review_received',
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
      const changesRequested = receipt.decision === 'changes_requested'
        || input.evidence.qualityDecision === 'reject'
        || input.evidence.blockerCount > 0;
      const passed = receipt.decision !== 'changes_requested'
        && input.evidence.qualityDecision === 'pass'
        && input.evidence.blockerCount === 0;
      const gateEvidence = qualityGateRepo.submitEvidence({
        gateId: gate.gate.id,
        evidenceType: 'provider_code_review',
        payload: {
          receipt,
          evidence: input.evidence,
          taskActionId: action.id,
        },
        sourceRef: receipt.reviewUrl,
        actor: { type: 'agent', id: input.actorAgentId },
        idempotencyKey: `task-review:${action.id}`,
      });
      const evaluating = gate.gate.status === 'requested'
        ? qualityGateRepo.beginEvaluation({
            gateId: gate.gate.id,
            evaluator: { type: 'agent', id: input.actorAgentId },
            expectedRevision: gate.gate.revision,
          })
        : gate;
      if (changesRequested || passed) {
        qualityGateRepo.decide({
          gateId: gate.gate.id,
          decision: changesRequested ? 'changes_requested' : 'passed',
          evaluator: { type: 'agent', id: input.actorAgentId },
          evidenceIds: [gateEvidence.id],
          reason: input.evidence.summary,
          expectedRevision: evaluating.gate.revision,
        });
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
    const audience = resolveTaskNotificationAudience(task.conversation_id);
    if (!audience.coordinatorAgentIds.includes(input.actorAgentId)) {
      throw new EngineeringCollaborationError('merge_actor_not_allowed', `${input.actorAgentId} is not the configured coordinator`);
    }
    const pullRequestAction = latestPullRequestAction(task.id);
    const reviewAction = latestReviewAction(task.id);
    if (!pullRequestAction) {
      throw new EngineeringCollaborationError('pull_request_receipt_missing', 'A verified pull request receipt is required before merge closure');
    }
    const pullRequestPayload = parsePayload(pullRequestAction);
    const pullRequest = pullRequestPayload.receipt as PullRequestReceipt | undefined;
    if (!pullRequest || pullRequest.url !== input.pullRequestUrl) {
      throw new EngineeringCollaborationError('merge_receipt_mismatch', 'Merge does not match the task pull request receipt');
    }
    const reviewGate = typeof pullRequestPayload.gateId === 'string'
      ? qualityGateRepo.getSnapshot(pullRequestPayload.gateId)
      : undefined;
    if (
      reviewGate?.gate.status !== 'passed'
      || reviewGate.gate.kind !== 'code_review'
      || reviewGate.gate.target_type !== 'task'
      || reviewGate.gate.target_id !== task.id
      || reviewGate.gate.artifact_revision !== String(pullRequestPayload.artifactRevision)
    ) {
      throw new EngineeringCollaborationError('review_approval_missing', 'A current provider-backed review with zero blockers is required before merge closure');
    }
    if (task.status !== 'done') {
      throw new EngineeringCollaborationError(
        'task_not_reviewable',
        `Task ${task.id} must be completed by the current Quality Gate before merge recording`,
      );
    }
    const cwd = gitRepoRoot(task);
    const receipt = await this.verifier.getMerge({ pullRequestUrl: input.pullRequestUrl, cwd });
    if (receipt.pullRequestUrl !== pullRequest.url || receipt.pullRequestNumber !== pullRequest.number || receipt.headSha !== pullRequest.headSha) {
      throw new EngineeringCollaborationError('merge_receipt_mismatch', 'Provider merge receipt does not match the current pull request head');
    }

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
      proofLogRepo.append({
        eventType: 'engineering.merge.verified',
        conversationId: task.conversation_id,
        taskId: task.id,
        actorId: input.actorAgentId,
        metadata: { mergeSha: receipt.mergeSha, headSha: receipt.headSha, actionId: action.id },
      });
      return { card, messageId };
    })();
    return { receipt, ...result };
  }
}
