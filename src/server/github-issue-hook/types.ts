export interface GitHubIssueHookConfig {
  secret: string;
  repository: string;
  projectPath: string;
  teamPackId?: string;
  triggerLabel?: string;
  skipLabel: string;
  trustedAssociations: string[];
  authorization: {
    allowPush: boolean;
    allowPullRequest: boolean;
    allowAutoMerge: boolean;
  };
  recoveryPolicy: {
    maxAttemptsPerAction: number;
    maxRepairCycles: number;
    stallTimeoutMs: number;
  };
  deliveryPolicy: {
    requireReview: boolean;
    requireWebE2E: boolean;
    requireMerge: boolean;
  };
}

export interface GitHubIssueWebhookPayload {
  action: string;
  issue: {
    number: number;
    node_id: string;
    html_url: string;
    title: string;
    body: string | null;
    state: string;
    author_association: string;
    user: { login: string };
    labels: Array<string | { name: string }>;
  };
  repository: {
    full_name: string;
  };
  sender?: {
    login?: string;
  };
}

export interface GitHubIssueIngressRow {
  id: string;
  delivery_id: string;
  repository_full_name: string;
  issue_number: number;
  issue_node_id: string;
  issue_url: string;
  action: string;
  payload_digest: string;
  conversation_id: string;
  delivery_run_id: string;
  status: 'started';
  received_at: string;
  processed_at: string;
}

export type GitHubIssueIngressIgnoredReason =
  | 'event_unsupported'
  | 'action_unsupported'
  | 'repository_not_allowed'
  | 'trigger_label_missing'
  | 'skip_label_present'
  | 'author_not_trusted'
  | 'issue_not_open';

export type GitHubIssueIngressResult =
  | {
      disposition: 'accepted';
      mapping: GitHubIssueIngressRow;
    }
  | {
      disposition: 'duplicate';
      mapping: GitHubIssueIngressRow;
    }
  | {
      disposition: 'ignored';
      reason: GitHubIssueIngressIgnoredReason;
    };
