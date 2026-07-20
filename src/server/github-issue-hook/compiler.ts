import type { GoalContract } from '../autonomous-delivery/types';
import type {
  GitHubIssueHookConfig,
  GitHubIssueWebhookPayload,
} from './types';

export class GitHubIssuePayloadError extends Error {
  readonly code = 'payload_invalid';
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

export function parseGitHubIssuePayload(value: unknown): GitHubIssueWebhookPayload {
  const payload = object(value);
  const issue = object(payload?.issue);
  const repository = object(payload?.repository);
  const user = object(issue?.user);
  const sender = object(payload?.sender);
  if (
    typeof payload?.action !== 'string'
    || typeof issue?.number !== 'number'
    || !Number.isSafeInteger(issue.number)
    || issue.number < 1
    || typeof issue.node_id !== 'string'
    || typeof issue.html_url !== 'string'
    || typeof issue.title !== 'string'
    || (issue.body !== null && typeof issue.body !== 'string')
    || typeof issue.state !== 'string'
    || typeof issue.author_association !== 'string'
    || typeof user?.login !== 'string'
    || !Array.isArray(issue.labels)
    || typeof repository?.full_name !== 'string'
  ) {
    throw new GitHubIssuePayloadError('Invalid GitHub issues payload');
  }

  const labels = issue.labels.map((label) => {
    if (typeof label === 'string') return label;
    const labelObject = object(label);
    if (typeof labelObject?.name !== 'string') {
      throw new GitHubIssuePayloadError('Invalid GitHub issue label');
    }
    return { name: labelObject.name };
  });

  return {
    action: payload.action,
    issue: {
      number: issue.number,
      node_id: issue.node_id,
      html_url: issue.html_url,
      title: issue.title,
      body: issue.body,
      state: issue.state,
      author_association: issue.author_association,
      user: { login: user.login },
      labels,
    },
    repository: { full_name: repository.full_name },
    sender: typeof sender?.login === 'string' ? { login: sender.login } : undefined,
  };
}

export function issueLabelNames(payload: GitHubIssueWebhookPayload): string[] {
  return payload.issue.labels
    .map((label) => typeof label === 'string' ? label : label.name)
    .map((label) => label.trim())
    .filter(Boolean);
}

export function extractIssueAcceptanceCriteria(body: string | null): string[] {
  const criteria: string[] = [];
  const seen = new Set<string>();
  for (const line of (body ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*[-*+]\s+\[\s\]\s+(.+?)\s*$/i);
    const criterion = match?.[1]?.trim();
    if (!criterion) continue;
    const key = criterion.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    criteria.push(criterion);
  }
  return criteria;
}

export function compileGitHubIssueGoalContract(
  payload: GitHubIssueWebhookPayload,
  config: GitHubIssueHookConfig,
  conversationId: string,
): GoalContract {
  const issueRef = `${payload.repository.full_name}#${payload.issue.number}`;
  const extracted = extractIssueAcceptanceCriteria(payload.issue.body);
  const acceptanceCriteria = extracted.length > 0
    ? extracted
    : [`完成并验证 ${issueRef} 描述的预期结果`];
  acceptanceCriteria.push(`保留与 ${issueRef} 对应的实现、评审和验证证据`);

  return {
    goal: `解决 GitHub Issue #${payload.issue.number}：${payload.issue.title.trim()}`,
    acceptanceCriteria,
    source: {
      kind: 'github_issue',
      externalId: payload.issue.node_id || issueRef,
      url: payload.issue.html_url,
      title: payload.issue.title,
      description: payload.issue.body ?? '',
      repository: payload.repository.full_name,
      issueNumber: payload.issue.number,
      labels: issueLabelNames(payload),
      sender: payload.sender?.login ?? payload.issue.user.login,
    },
    scope: {
      conversationId,
      projectPath: config.projectPath,
      repository: payload.repository.full_name,
    },
    authorization: {
      allowCodeChanges: true,
      allowPush: config.authorization.allowPush,
      allowPullRequest: config.authorization.allowPullRequest,
      allowAutoMerge: config.authorization.allowAutoMerge,
    },
    recoveryPolicy: { ...config.recoveryPolicy },
    deliveryPolicy: { ...config.deliveryPolicy },
  };
}
