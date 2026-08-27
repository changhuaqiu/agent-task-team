export const PROJECT_REVIEW_STATUSES = [
  'open',
  'changes_requested',
  'approved',
  'closed',
] as const;

export type ProjectReviewStatus = (typeof PROJECT_REVIEW_STATUSES)[number];

export interface ProjectReview {
  id: string;
  projectId: string;
  repositoryRoot: string;
  baseRef: string;
  compareRef: string;
  title: string;
  description: string;
  status: ProjectReviewStatus;
  decisionSummary?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  reference: string;
}
