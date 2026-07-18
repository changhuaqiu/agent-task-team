import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, setTestDb } from '@/server/db';
import { seedPresetAgents } from '@/server/db/seed-agents';
import { seedTeamPacks } from '@/server/seed-team-packs';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { taskGraphRepo } from '@/server/repositories/task-graph-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { EngineeringCollaborationError, EngineeringCollaborationService } from '@/server/engineering-collaboration/service';
import type { GitProviderVerifier } from '@/server/engineering-collaboration/git-provider';
import type { MergeReceipt, PullRequestReceipt, ReviewReceipt } from '@/lib/engineering-collaboration/types';

const pullRequest: PullRequestReceipt = {
  provider: 'github', repository: 'acme/widget', number: 42, title: 'Fix checkout',
  url: 'https://github.com/acme/widget/pull/42', state: 'open', draft: false, author: 'developer',
  baseRef: 'main', headRef: 'task/checkout', headSha: 'a'.repeat(40), checks: 'passing',
  verifiedAt: '2026-07-18T00:00:00.000Z',
};

const review: ReviewReceipt = {
  provider: 'github', repository: 'acme/widget', pullRequestNumber: 42,
  pullRequestUrl: pullRequest.url, reviewId: 'review-1',
  reviewUrl: 'https://github.com/acme/widget/pull/42#pullrequestreview-1',
  providerActor: 'shared-bot', decision: 'changes_requested', headSha: pullRequest.headSha,
  submittedAt: '2026-07-18T00:05:00.000Z', verifiedAt: '2026-07-18T00:05:01.000Z',
};

const merge: MergeReceipt = {
  provider: 'github', repository: 'acme/widget', pullRequestNumber: 42,
  pullRequestUrl: pullRequest.url, headSha: pullRequest.headSha, mergeSha: 'c'.repeat(40),
  baseRef: 'main', mergedBy: 'maintainer', mergedAt: '2026-07-18T00:10:00.000Z',
  verifiedAt: '2026-07-18T00:10:01.000Z',
};

function verifier(overrides?: Partial<GitProviderVerifier>): GitProviderVerifier {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getReview: vi.fn(async () => review),
    getMerge: vi.fn(async () => merge),
    ...overrides,
  };
}

beforeEach(() => {
  setTestDb(createTestDb());
  seedPresetAgents();
  seedTeamPacks();
  const pack = teamPackRepo.getByName('default-team')!;
  conversationRepo.create({
    id: 'conv-pr-loop', title: 'PR loop', team_pack_id: pack.id,
    project_path: 'C:/repo', git_repo_root: 'C:/repo',
  });
  taskRepo.create({ id: 'TASK-PR', conversation_id: 'conv-pr-loop', title: 'Fix checkout', agent_id: 'luigi' });
  taskRepo.updateStatus('TASK-PR', 'in_progress');
});

describe('EngineeringCollaborationService', () => {
  it('records a provider-verified PR as task action, artifact, card, proof and review transition', async () => {
    const service = new EngineeringCollaborationService(verifier());

    const result = await service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: {
        installResult: 'pnpm install unchanged', buildResult: 'build passed',
        testResult: '42 tests passed', impactEvidence: 'checkout API and UI inspected',
      },
    });

    expect(result.receipt).toEqual(pullRequest);
    expect(taskRepo.getById('TASK-PR')?.status).toBe('in_review');
    expect(taskGraphRepo.listActionsForTask('TASK-PR')).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task.pull_request_submitted', actor_id: 'luigi' }),
    ]));
    expect(taskGraphRepo.listArtifacts('conv-pr-loop')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'pull_request', url: pullRequest.url }),
    ]));
    const message = messageRepo.getById(result.messageId)!;
    expect(JSON.parse(message.metadata!)).toMatchObject({ collaborationCard: {
      kind: 'pull_request', taskId: 'TASK-PR', receipt: { headSha: pullRequest.headSha },
    } });
    expect(proofLogRepo.findByType({ eventType: 'engineering.pull_request.verified', conversationId: 'conv-pr-loop', taskId: 'TASK-PR' })).toHaveLength(1);
  });

  it('rejects PR submission from an agent that does not own the task', async () => {
    const service = new EngineeringCollaborationService(verifier());
    await expect(service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'peach', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
    })).rejects.toMatchObject<Partial<EngineeringCollaborationError>>({ reasonCode: 'task_actor_mismatch' });
  });

  it('records a real quality-gate review and returns rejected work to the implementer', async () => {
    const service = new EngineeringCollaborationService(verifier());
    await service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
    });

    const result = await service.recordReview({
      taskId: 'TASK-PR', actorAgentId: 'peach', pullRequestUrl: pullRequest.url, reviewUrl: review.reviewUrl,
      evidence: { testResult: 'Playwright failed on checkout', blockerCount: 1, summary: 'Checkout loses the selected address.' },
    });

    expect(result.receipt).toEqual(review);
    expect(taskRepo.getById('TASK-PR')).toMatchObject({ status: 'rejected', review_note: 'Checkout loses the selected address.' });
    expect(taskGraphRepo.listArtifacts('conv-pr-loop')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'review', url: review.reviewUrl }),
    ]));
    expect(JSON.parse(messageRepo.getById(result.messageId)!.metadata!)).toMatchObject({ collaborationCard: {
      kind: 'review', receipt: { decision: 'changes_requested', headSha: pullRequest.headSha },
    } });
  });

  it('fails closed when a review targets a different head SHA', async () => {
    const staleReview = { ...review, headSha: 'b'.repeat(40) };
    const service = new EngineeringCollaborationService(verifier({ getReview: vi.fn(async () => staleReview) }));
    await service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
    });

    await expect(service.recordReview({
      taskId: 'TASK-PR', actorAgentId: 'peach', pullRequestUrl: pullRequest.url, reviewUrl: staleReview.reviewUrl,
      evidence: { testResult: 'ok', blockerCount: 0, summary: 'Looks good' },
    })).rejects.toMatchObject<Partial<EngineeringCollaborationError>>({ reasonCode: 'pull_request_head_changed' });
    expect(taskGraphRepo.listArtifacts('conv-pr-loop').filter((artifact) => artifact.kind === 'review')).toHaveLength(0);
  });

  it('records a new head on the same PR and publishes the previous review as stale', async () => {
    const service = new EngineeringCollaborationService(verifier());
    await service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
    });
    await service.recordReview({
      taskId: 'TASK-PR', actorAgentId: 'peach', pullRequestUrl: pullRequest.url, reviewUrl: review.reviewUrl,
      evidence: { testResult: 'failed', blockerCount: 1, summary: 'Fix it' },
    });
    const nextPullRequest = { ...pullRequest, headSha: 'b'.repeat(40) };
    const refreshService = new EngineeringCollaborationService(verifier({ getPullRequest: vi.fn(async () => nextPullRequest) }));
    const result = await refreshService.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'fixed', impactEvidence: 'rechecked' },
    });

    expect(result.receipt.headSha).toBe(nextPullRequest.headSha);
    expect(taskRepo.getById('TASK-PR')?.status).toBe('in_review');
    const cards = messageRepo.getByConversation('conv-pr-loop')
      .map((message) => message.metadata ? JSON.parse(message.metadata).collaborationCard : undefined)
      .filter(Boolean);
    expect(cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'review', stale: true, receipt: expect.objectContaining({ headSha: pullRequest.headSha }) }),
    ]));
  });

  it('closes only from a verified merge on the reviewed head with main evidence', async () => {
    const approvedReview = { ...review, decision: 'approved' as const };
    const service = new EngineeringCollaborationService(verifier({ getReview: vi.fn(async () => approvedReview) }));
    await service.recordPullRequest({
      taskId: 'TASK-PR', actorAgentId: 'luigi', pullRequestUrl: pullRequest.url,
      evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
    });
    await service.recordReview({
      taskId: 'TASK-PR', actorAgentId: 'peach', pullRequestUrl: pullRequest.url, reviewUrl: review.reviewUrl,
      evidence: { testResult: 'passed', blockerCount: 0, summary: 'Approved' },
    });

    const result = await service.recordMerge({
      taskId: 'TASK-PR', actorAgentId: 'mario', pullRequestUrl: pullRequest.url,
      evidence: {
        mergedToMain: true, mainInstallResult: 'ok', mainBuildResult: 'ok',
        mainTestResult: 'all passed', mainImpactReviewResult: 'main verified',
      },
    });

    expect(result.receipt).toEqual(merge);
    expect(taskRepo.getById('TASK-PR')?.status).toBe('done');
    expect(taskGraphRepo.listArtifacts('conv-pr-loop')).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'merge', url: pullRequest.url }),
    ]));
    expect(JSON.parse(messageRepo.getById(result.messageId)!.metadata!)).toMatchObject({ collaborationCard: {
      kind: 'merge', receipt: { mergeSha: merge.mergeSha }, evidence: { mainTestResult: 'all passed' },
    } });
  });
});
