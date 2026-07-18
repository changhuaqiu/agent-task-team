export type GitProvider = 'github';
export type PullRequestChecks = 'pending' | 'passing' | 'failing' | 'unknown';
export type ReviewDecision = 'approved' | 'changes_requested' | 'commented';

export interface PullRequestReceipt {
  provider: GitProvider;
  repository: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  checks: PullRequestChecks;
  verifiedAt: string;
}

export interface ReviewReceipt {
  provider: GitProvider;
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  reviewId: string;
  reviewUrl: string;
  providerActor: string;
  decision: ReviewDecision;
  headSha: string;
  submittedAt: string;
  verifiedAt: string;
}

export interface MergeReceipt {
  provider: GitProvider;
  repository: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  headSha: string;
  mergeSha: string;
  baseRef: string;
  mergedBy: string;
  mergedAt: string;
  verifiedAt: string;
}

export interface ImplementationEvidence {
  installResult: string;
  buildResult: string;
  testResult: string;
  impactEvidence: string;
  riskSummary?: string;
}

export interface ReviewEvidence {
  testResult: string;
  blockerCount: number;
  summary: string;
}

export interface MergeEvidence {
  mergedToMain: true;
  mainInstallResult: string;
  mainBuildResult: string;
  mainTestResult: string;
  mainImpactReviewResult: string;
  remainingRisk?: string;
}

interface CollaborationCardBase {
  version: 1;
  taskId: string;
  actorAgentId: string;
  createdAt: string;
}

export interface PullRequestCollaborationCard extends CollaborationCardBase {
  kind: 'pull_request';
  receipt: PullRequestReceipt;
  evidence: ImplementationEvidence;
}

export interface ReviewCollaborationCard extends CollaborationCardBase {
  kind: 'review';
  receipt: ReviewReceipt;
  evidence: ReviewEvidence;
  stale?: boolean;
}

export interface MergeCollaborationCard extends CollaborationCardBase {
  kind: 'merge';
  receipt: MergeReceipt;
  evidence: MergeEvidence;
}

export type EngineeringCollaborationCard =
  | PullRequestCollaborationCard
  | ReviewCollaborationCard
  | MergeCollaborationCard;

export function isEngineeringCollaborationCard(value: unknown): value is EngineeringCollaborationCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Partial<EngineeringCollaborationCard>;
  return card.version === 1
    && typeof card.taskId === 'string'
    && typeof card.actorAgentId === 'string'
    && typeof card.createdAt === 'string'
    && (card.kind === 'pull_request' || card.kind === 'review' || card.kind === 'merge');
}
