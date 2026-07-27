import { getDb } from '../db';
import type { AutonomousDeliveryRuntimePort } from '../autonomous-delivery/control-runtime';
import { conversationRepo } from '../repositories/conversation-repo';
import { generateSortableId } from '../repositories/sortable-id';
import { compileGitHubIssueGoalContract, issueLabelNames, parseGitHubIssuePayload } from './compiler';
import {
  githubIssueIngressRepo,
  GitHubIssueIngressRepository,
} from './repository';
import type {
  GitHubIssueHookConfig,
  GitHubIssueIngressResult,
} from './types';

export interface GitHubIssueAgentIngressOptions {
  supervisor?: Pick<AutonomousDeliveryRuntimePort, 'start'>;
  resolveSupervisor?: () => Pick<AutonomousDeliveryRuntimePort, 'start'> | undefined;
  repository?: GitHubIssueIngressRepository;
  now?: () => Date;
}

export class GitHubIssueAgentIngress {
  private readonly supervisor?: Pick<AutonomousDeliveryRuntimePort, 'start'>;
  private readonly resolveSupervisor?: () => Pick<AutonomousDeliveryRuntimePort, 'start'> | undefined;
  private readonly repository: GitHubIssueIngressRepository;
  private readonly now: () => Date;

  constructor(options: GitHubIssueAgentIngressOptions) {
    this.supervisor = options.supervisor;
    this.resolveSupervisor = options.resolveSupervisor;
    this.repository = options.repository ?? githubIssueIngressRepo;
    this.now = options.now ?? (() => new Date());
  }

  handle(input: {
    eventName: string;
    deliveryId: string;
    payload: unknown;
    payloadDigest: string;
    config: GitHubIssueHookConfig;
  }): GitHubIssueIngressResult {
    if (input.eventName !== 'issues') {
      return { disposition: 'ignored', reason: 'event_unsupported' };
    }

    const payload = parseGitHubIssuePayload(input.payload);
    if (payload.action !== 'opened') {
      return { disposition: 'ignored', reason: 'action_unsupported' };
    }
    if (payload.repository.full_name.toLowerCase() !== input.config.repository.toLowerCase()) {
      return { disposition: 'ignored', reason: 'repository_not_allowed' };
    }
    if (payload.issue.state.toLowerCase() !== 'open') {
      return { disposition: 'ignored', reason: 'issue_not_open' };
    }
    if (
      !input.config.trustedAssociations.includes(
        payload.issue.author_association.toUpperCase(),
      )
    ) {
      return { disposition: 'ignored', reason: 'author_not_trusted' };
    }

    const labels = new Set(issueLabelNames(payload).map((label) => label.toLowerCase()));
    if (input.config.skipLabel && labels.has(input.config.skipLabel.toLowerCase())) {
      return { disposition: 'ignored', reason: 'skip_label_present' };
    }
    if (
      input.config.triggerLabel
      && !labels.has(input.config.triggerLabel.toLowerCase())
    ) {
      return { disposition: 'ignored', reason: 'trigger_label_missing' };
    }

    const duplicate = this.repository.getByDeliveryId(input.deliveryId)
      ?? this.repository.getByIssue(
        payload.repository.full_name,
        payload.issue.number,
      );
    if (duplicate) {
      return { disposition: 'duplicate', mapping: duplicate };
    }
    const supervisor = this.supervisor ?? this.resolveSupervisor?.();
    if (!supervisor) {
      throw new GitHubIssueRuntimeUnavailableError();
    }

    return getDb().transaction(() => {
      const existingDelivery = this.repository.getByDeliveryId(input.deliveryId);
      if (existingDelivery) {
        return { disposition: 'duplicate', mapping: existingDelivery } as const;
      }
      const existingIssue = this.repository.getByIssue(
        payload.repository.full_name,
        payload.issue.number,
      );
      if (existingIssue) {
        return { disposition: 'duplicate', mapping: existingIssue } as const;
      }
      const conversationId = generateSortableId('conversation');
      const title = `#${payload.issue.number} ${payload.issue.title.trim()}`;
      conversationRepo.create({
        id: conversationId,
        title,
        goal: title,
        project_path: input.config.projectPath,
        git_repo_root: input.config.projectPath,
        use_worktree: true,
        team_pack_id: input.config.teamPackId,
      });
      const contract = compileGitHubIssueGoalContract(payload, input.config, conversationId);
      const snapshot = supervisor.start(contract);
      const timestamp = this.now().toISOString();
      const mapping = this.repository.create({
        deliveryId: input.deliveryId,
        repositoryFullName: payload.repository.full_name.toLowerCase(),
        issueNumber: payload.issue.number,
        issueNodeId: payload.issue.node_id,
        issueUrl: payload.issue.html_url,
        action: payload.action,
        payloadDigest: input.payloadDigest,
        conversationId,
        deliveryRunId: snapshot.run.id,
        now: timestamp,
      });
      return { disposition: 'accepted', mapping } as const;
    })();
  }
}

export class GitHubIssueRuntimeUnavailableError extends Error {
  readonly code = 'runtime_unavailable';

  constructor() {
    super('Agent runtime is not ready');
  }
}
