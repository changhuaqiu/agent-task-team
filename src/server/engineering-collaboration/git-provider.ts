import type { MergeReceipt, PullRequestReceipt, ReviewReceipt } from '@/lib/engineering-collaboration/types';

export interface GitProviderVerifier {
  getPullRequest(input: { url: string; cwd?: string }): Promise<PullRequestReceipt>;
  getReview(input: { pullRequestUrl: string; reviewUrl: string; cwd?: string }): Promise<ReviewReceipt>;
  getMerge(input: { pullRequestUrl: string; cwd?: string }): Promise<MergeReceipt>;
}
