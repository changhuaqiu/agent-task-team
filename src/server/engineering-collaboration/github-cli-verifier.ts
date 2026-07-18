import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MergeReceipt, PullRequestChecks, PullRequestReceipt, ReviewDecision, ReviewReceipt } from '@/lib/engineering-collaboration/types';
import type { GitProviderVerifier } from './git-provider';

const execFileAsync = promisify(execFile);

export type GitProviderVerificationReasonCode =
  | 'git_provider_auth_missing'
  | 'git_provider_unavailable'
  | 'pull_request_not_found'
  | 'pull_request_not_merged'
  | 'review_receipt_missing'
  | 'repository_mismatch'
  | 'git_provider_response_invalid';

export class GitProviderVerificationError extends Error {
  constructor(public readonly reasonCode: GitProviderVerificationReasonCode, message: string) {
    super(message);
    this.name = 'GitProviderVerificationError';
  }
}

interface GhAuthor { login?: string }
interface GhCheck { status?: string; conclusion?: string }
interface GhPullRequest {
  author?: GhAuthor;
  baseRefName?: string;
  headRefName?: string;
  headRefOid?: string;
  isDraft?: boolean;
  number?: number;
  state?: string;
  statusCheckRollup?: GhCheck[];
  title?: string;
  url?: string;
  mergeCommit?: { oid?: string };
  mergedAt?: string;
  mergedBy?: GhAuthor;
}

interface GhReview {
  id?: string;
  url?: string;
  author?: GhAuthor;
  state?: string;
  submittedAt?: string;
  commit?: { oid?: string };
}

interface GhComment {
  id?: string;
  url?: string;
  author?: GhAuthor;
  createdAt?: string;
}

interface GhCommit {
  oid?: string;
  committedDate?: string;
}

export function providerCommentAppliesToHead(input: {
  commentCreatedAt?: string;
  headSha?: string;
  commits?: GhCommit[];
}): boolean {
  if (!input.commentCreatedAt || !input.headSha) return false;
  const headCommit = input.commits?.find((commit) => commit.oid === input.headSha);
  if (!headCommit?.committedDate) return false;
  const commentTime = Date.parse(input.commentCreatedAt);
  const commitTime = Date.parse(headCommit.committedDate);
  return Number.isFinite(commentTime) && Number.isFinite(commitTime) && commentTime >= commitTime;
}

function parseGitHubUrl(url: string): { repository: string; number: number } {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[#/?].*)?$/i.exec(url.trim());
  if (!match) {
    throw new GitProviderVerificationError('git_provider_response_invalid', 'A canonical GitHub pull request URL is required');
  }
  return { repository: match[1].replace(/\.git$/i, ''), number: Number(match[2]) };
}

function checksStatus(checks: GhCheck[] | undefined): PullRequestChecks {
  if (!checks || checks.length === 0) return 'unknown';
  if (checks.some((check) => String(check.status ?? '').toUpperCase() !== 'COMPLETED')) return 'pending';
  const accepted = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
  return checks.every((check) => accepted.has(String(check.conclusion ?? '').toUpperCase())) ? 'passing' : 'failing';
}

function reviewDecision(state: string | undefined): ReviewDecision {
  if (state === 'APPROVED') return 'approved';
  if (state === 'CHANGES_REQUESTED') return 'changes_requested';
  return 'commented';
}

function normalizeState(state: string | undefined): PullRequestReceipt['state'] {
  if (state === 'MERGED') return 'merged';
  if (state === 'CLOSED') return 'closed';
  return 'open';
}

export class GhCliGitProviderVerifier implements GitProviderVerifier {
  private async gh(args: string[], cwd?: string): Promise<unknown> {
    try {
      const { stdout } = await execFileAsync('gh', args, {
        cwd,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 2 * 1024 * 1024,
      });
      return JSON.parse(stdout);
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      const detail = `${failure.message ?? ''}\n${failure.stderr ?? ''}`;
      if (/auth|login|token|HTTP 401/i.test(detail)) {
        throw new GitProviderVerificationError('git_provider_auth_missing', 'GitHub authentication is unavailable; run gh auth login');
      }
      if (failure.code === 'ENOENT') {
        throw new GitProviderVerificationError('git_provider_unavailable', 'GitHub CLI is not installed');
      }
      if (/not found|Could not resolve|no pull requests found/i.test(detail)) {
        throw new GitProviderVerificationError('pull_request_not_found', 'The pull request could not be found');
      }
      throw new GitProviderVerificationError('git_provider_unavailable', 'GitHub could not be queried');
    }
  }

  private async assertRepository(repository: string, cwd?: string): Promise<void> {
    if (!cwd) return;
    const local = await this.gh(['repo', 'view', '--json', 'nameWithOwner'], cwd) as { nameWithOwner?: string };
    if (!local.nameWithOwner || local.nameWithOwner.toLowerCase() !== repository.toLowerCase()) {
      throw new GitProviderVerificationError('repository_mismatch', `Pull request repository ${repository} does not match the project repository`);
    }
  }

  async getPullRequest(input: { url: string; cwd?: string }): Promise<PullRequestReceipt> {
    const identity = parseGitHubUrl(input.url);
    await this.assertRepository(identity.repository, input.cwd);
    const raw = await this.gh([
      'pr', 'view', input.url, '--json',
      'author,baseRefName,headRefName,headRefOid,isDraft,number,state,statusCheckRollup,title,url',
    ], input.cwd) as GhPullRequest;
    if (!raw.url || !raw.number || !raw.headRefOid || !raw.baseRefName || !raw.headRefName || !raw.title) {
      throw new GitProviderVerificationError('git_provider_response_invalid', 'GitHub returned an incomplete pull request response');
    }
    if (raw.number !== identity.number) {
      throw new GitProviderVerificationError('git_provider_response_invalid', 'GitHub returned a different pull request number');
    }
    return {
      provider: 'github',
      repository: identity.repository,
      number: raw.number,
      title: raw.title,
      url: raw.url,
      state: normalizeState(raw.state),
      draft: Boolean(raw.isDraft),
      author: raw.author?.login ?? 'unknown',
      baseRef: raw.baseRefName,
      headRef: raw.headRefName,
      headSha: raw.headRefOid,
      checks: checksStatus(raw.statusCheckRollup),
      verifiedAt: new Date().toISOString(),
    };
  }

  async getReview(input: { pullRequestUrl: string; reviewUrl: string; cwd?: string }): Promise<ReviewReceipt> {
    const identity = parseGitHubUrl(input.pullRequestUrl);
    await this.assertRepository(identity.repository, input.cwd);
    const raw = await this.gh([
      'pr', 'view', input.pullRequestUrl, '--json', 'headRefOid,reviews,comments,commits',
    ], input.cwd) as { headRefOid?: string; reviews?: GhReview[]; comments?: GhComment[]; commits?: GhCommit[] };
    const review = raw.reviews?.find((item) => item.url === input.reviewUrl || input.reviewUrl.endsWith(String(item.id ?? '')));
    if (review) {
      return {
        provider: 'github', repository: identity.repository, pullRequestNumber: identity.number,
        pullRequestUrl: input.pullRequestUrl, reviewId: review.id ?? input.reviewUrl,
        reviewUrl: review.url ?? input.reviewUrl, providerActor: review.author?.login ?? 'unknown',
        decision: reviewDecision(review.state), headSha: review.commit?.oid ?? raw.headRefOid ?? '',
        submittedAt: review.submittedAt ?? new Date().toISOString(), verifiedAt: new Date().toISOString(),
      };
    }
    const comment = raw.comments?.find((item) => item.url === input.reviewUrl || input.reviewUrl.endsWith(String(item.id ?? '')));
    if (comment && providerCommentAppliesToHead({ commentCreatedAt: comment.createdAt, headSha: raw.headRefOid, commits: raw.commits })) {
      return {
        provider: 'github', repository: identity.repository, pullRequestNumber: identity.number,
        pullRequestUrl: input.pullRequestUrl, reviewId: comment.id ?? input.reviewUrl,
        reviewUrl: comment.url ?? input.reviewUrl, providerActor: comment.author?.login ?? 'unknown',
        decision: 'commented', headSha: raw.headRefOid,
        submittedAt: comment.createdAt ?? new Date().toISOString(), verifiedAt: new Date().toISOString(),
      };
    }
    throw new GitProviderVerificationError('review_receipt_missing', 'The GitHub review or comment could not be verified');
  }

  async getMerge(input: { pullRequestUrl: string; cwd?: string }): Promise<MergeReceipt> {
    const identity = parseGitHubUrl(input.pullRequestUrl);
    await this.assertRepository(identity.repository, input.cwd);
    const raw = await this.gh([
      'pr', 'view', input.pullRequestUrl, '--json',
      'baseRefName,headRefOid,mergeCommit,mergedAt,mergedBy,number,state,url',
    ], input.cwd) as GhPullRequest;
    if (raw.state !== 'MERGED') {
      throw new GitProviderVerificationError('pull_request_not_merged', 'The pull request has not been merged');
    }
    if (!raw.url || raw.number !== identity.number || !raw.headRefOid || !raw.baseRefName || !raw.mergeCommit?.oid || !raw.mergedAt) {
      throw new GitProviderVerificationError('git_provider_response_invalid', 'GitHub returned an incomplete merge response');
    }
    return {
      provider: 'github',
      repository: identity.repository,
      pullRequestNumber: raw.number,
      pullRequestUrl: raw.url,
      headSha: raw.headRefOid,
      mergeSha: raw.mergeCommit.oid,
      baseRef: raw.baseRefName,
      mergedBy: raw.mergedBy?.login ?? 'unknown',
      mergedAt: raw.mergedAt,
      verifiedAt: new Date().toISOString(),
    };
  }
}
