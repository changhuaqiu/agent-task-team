import type { GitHubIssueHookConfig, GitHubIssueWebhookPayload } from './types';

export function githubIssueHookConfig(
  projectPath: string,
  overrides: Partial<GitHubIssueHookConfig> = {},
): GitHubIssueHookConfig {
  return {
    secret: 'test-webhook-secret-with-safe-length',
    repository: 'acme/widgets',
    projectPath,
    skipLabel: 'agent:skip',
    trustedAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    authorization: {
      allowPush: false,
      allowPullRequest: false,
      allowAutoMerge: false,
    },
    recoveryPolicy: {
      maxAttemptsPerAction: 3,
      maxRepairCycles: 2,
      stallTimeoutMs: 900_000,
    },
    deliveryPolicy: {
      requireReview: true,
      requireWebE2E: false,
      requireMerge: false,
    },
    ...overrides,
  };
}

export function githubIssuePayload(
  overrides: Partial<GitHubIssueWebhookPayload> = {},
): GitHubIssueWebhookPayload {
  return {
    action: 'opened',
    issue: {
      number: 42,
      node_id: 'I_kwDO-test',
      html_url: 'https://github.com/acme/widgets/issues/42',
      title: 'Add automatic issue intake',
      body: [
        'Create an automatic intake path.',
        '',
        '- [ ] Verify webhook signatures',
        '- [ ] Avoid duplicate delivery runs',
      ].join('\n'),
      state: 'open',
      author_association: 'MEMBER',
      user: { login: 'octocat' },
      labels: [{ name: 'agent:run' }],
    },
    repository: { full_name: 'acme/widgets' },
    sender: { login: 'octocat' },
    ...overrides,
  };
}
