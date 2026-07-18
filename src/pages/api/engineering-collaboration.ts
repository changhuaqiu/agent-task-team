import type { NextApiRequest, NextApiResponse } from 'next';
import { EngineeringCollaborationError, EngineeringCollaborationService } from '@/server/engineering-collaboration/service';
import { GhCliGitProviderVerifier, GitProviderVerificationError } from '@/server/engineering-collaboration/github-cli-verifier';
import type { ImplementationEvidence, ReviewEvidence } from '@/lib/engineering-collaboration/types';

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
  if (!testResult || !summary || typeof blockerCount !== 'number' || !Number.isInteger(blockerCount) || blockerCount < 0) return undefined;
  return { testResult, summary, blockerCount };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!isRecord(req.body)) return res.status(400).json({ error: 'Invalid request body' });
  const kind = text(req.body.kind);
  const taskId = text(req.body.taskId);
  const actorAgentId = text(req.body.actorAgentId);
  const pullRequestUrl = text(req.body.pullRequestUrl);
  if (!taskId || !actorAgentId || !pullRequestUrl) {
    return res.status(400).json({ error: 'taskId, actorAgentId and pullRequestUrl are required' });
  }

  const service = new EngineeringCollaborationService(new GhCliGitProviderVerifier());
  try {
    if (kind === 'pull_request') {
      const evidence = implementationEvidence(req.body.evidence);
      if (!evidence) return res.status(400).json({ error: 'Complete implementation evidence is required' });
      const result = await service.recordPullRequest({ taskId, actorAgentId, pullRequestUrl, evidence });
      return res.status(201).json(result);
    }
    if (kind === 'review') {
      const reviewUrl = text(req.body.reviewUrl);
      const evidence = reviewEvidence(req.body.evidence);
      if (!reviewUrl || !evidence) return res.status(400).json({ error: 'reviewUrl and complete review evidence are required' });
      const result = await service.recordReview({ taskId, actorAgentId, pullRequestUrl, reviewUrl, evidence });
      return res.status(201).json(result);
    }
    return res.status(400).json({ error: 'kind must be pull_request or review' });
  } catch (error) {
    if (error instanceof EngineeringCollaborationError || error instanceof GitProviderVerificationError) {
      return res.status(409).json({ error: error.message, reasonCode: error.reasonCode });
    }
    console.error('[engineering-collaboration] unexpected error', error);
    return res.status(500).json({ error: 'Failed to record engineering collaboration receipt' });
  }
}
