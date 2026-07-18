import type { NextApiRequest, NextApiResponse } from 'next';
import { EngineeringCollaborationError, EngineeringCollaborationService } from '@/server/engineering-collaboration/service';
import { GhCliGitProviderVerifier, GitProviderVerificationError } from '@/server/engineering-collaboration/github-cli-verifier';
import type { ImplementationEvidence, MergeEvidence, ReviewEvidence } from '@/lib/engineering-collaboration/types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function implementationEvidence(value: unknown): ImplementationEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const installResult = text(value.installResult);
  const buildResult = text(value.buildResult);
  const testResult = text(value.testResult);
  const impactEvidence = text(value.impactEvidence);
  if (!installResult || !buildResult || !testResult || !impactEvidence) return undefined;
  return { installResult, buildResult, testResult, impactEvidence, riskSummary: text(value.riskSummary) };
}

function reviewEvidence(value: unknown): ReviewEvidence | undefined {
  if (!isRecord(value)) return undefined;
  const testResult = text(value.testResult);
  const summary = text(value.summary);
  const blockerCount = value.blockerCount;
  const qualityDecision = value.qualityDecision;
  if (!testResult || !summary || typeof blockerCount !== 'number' || !Number.isInteger(blockerCount) || blockerCount < 0) return undefined;
  if (qualityDecision !== 'pass' && qualityDecision !== 'reject' && qualityDecision !== 'comment') return undefined;
  return { testResult, summary, blockerCount, qualityDecision };
}

function mergeEvidence(value: unknown): MergeEvidence | undefined {
  if (!isRecord(value) || value.mergedToMain !== true) return undefined;
  const mainInstallResult = text(value.mainInstallResult);
  const mainBuildResult = text(value.mainBuildResult);
  const mainTestResult = text(value.mainTestResult);
  const mainImpactReviewResult = text(value.mainImpactReviewResult);
  if (!mainInstallResult || !mainBuildResult || !mainTestResult || !mainImpactReviewResult) return undefined;
  return {
    mergedToMain: true,
    mainInstallResult,
    mainBuildResult,
    mainTestResult,
    mainImpactReviewResult,
    remainingRisk: text(value.remainingRisk),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const remoteAddress = req.socket.remoteAddress ?? '';
  const loopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' || remoteAddress === '::ffff:127.0.0.1';
  if (process.env.NODE_ENV === 'production' && (process.env.ATH_ENABLE_COLLABORATION_TEST_API !== '1' || !loopback)) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Invalid request body' });
  const kind = text(req.body.kind);
  const taskId = text(req.body.taskId);
  const conversationId = text(req.body.conversationId);
  const actorAgentId = text(req.body.actorAgentId);
  const pullRequestUrl = text(req.body.pullRequestUrl);
  if (!taskId || !conversationId || !actorAgentId || !pullRequestUrl) {
    return res.status(400).json({ error: 'taskId, conversationId, actorAgentId and pullRequestUrl are required' });
  }

  const service = new EngineeringCollaborationService(new GhCliGitProviderVerifier(), (res.socket as typeof res.socket & { server?: { io?: import('socket.io').Server } }).server?.io);
  try {
    if (kind === 'pull_request') {
      const evidence = implementationEvidence(req.body.evidence);
      if (!evidence) return res.status(400).json({ error: 'Complete implementation evidence is required' });
      const result = await service.recordPullRequest({ taskId, expectedConversationId: conversationId, actorAgentId, pullRequestUrl, evidence });
      return res.status(201).json(result);
    }
    if (kind === 'review') {
      const reviewUrl = text(req.body.reviewUrl);
      const evidence = reviewEvidence(req.body.evidence);
      if (!reviewUrl || !evidence) return res.status(400).json({ error: 'reviewUrl and complete review evidence are required' });
      const result = await service.recordReview({ taskId, expectedConversationId: conversationId, actorAgentId, pullRequestUrl, reviewUrl, evidence });
      return res.status(201).json(result);
    }
    if (kind === 'merge') {
      const evidence = mergeEvidence(req.body.evidence);
      if (!evidence) return res.status(400).json({ error: 'Complete main-branch delivery evidence is required' });
      const result = await service.recordMerge({ taskId, expectedConversationId: conversationId, actorAgentId, pullRequestUrl, evidence });
      return res.status(201).json(result);
    }
    return res.status(400).json({ error: 'kind must be pull_request, review or merge' });
  } catch (error) {
    if (error instanceof EngineeringCollaborationError || error instanceof GitProviderVerificationError) {
      return res.status(409).json({ error: error.message, reasonCode: error.reasonCode });
    }
    console.error('[engineering-collaboration] unexpected error', error);
    return res.status(500).json({ error: 'Failed to record engineering collaboration receipt' });
  }
}
