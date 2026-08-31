import { getDb } from '../db';
import type { AutonomousDeliveryRuntimePort } from '../autonomous-delivery/control-runtime';
import { conversationRepo } from '../repositories/conversation-repo';
import { projectRepo } from '../repositories/project-repo';
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
  runtime?: Pick<AutonomousDeliveryRuntimePort, 'start'>;
  resolveRuntime?: () => Pick<AutonomousDeliveryRuntimePort, 'start'> | undefined;
  repository?: GitHubIssueIngressRepository;
  now?: () => Date;
}

export class GitHubIssueAgentIngress {
  private readonly runtime?: Pick<AutonomousDeliveryRuntimePort, 'start'>;
  private readonly resolveRuntime?: () => Pick<AutonomousDeliveryRuntimePort, 'start'> | undefined;
  private readonly repository: GitHubIssueIngressRepository;
  private readonly now: () => Date;

  constructor(options: GitHubIssueAgentIngressOptions) {
    this.runtime = options.runtime;
    this.resolveRuntime = options.resolveRuntime;
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
    const runtime = this.runtime ?? this.resolveRuntime?.();
    if (!runtime) {
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
      const projectName = payload.repository.full_name.split('/').filter(Boolean).at(-1)
        ?? payload.repository.full_name;
      const project = projectRepo.create({
        name: projectName,
        rootPath: input.config.projectPath,
      });
      const conversationId = generateSortableId('workstream');
      const title = `#${payload.issue.number} ${payload.issue.title.trim()}`;
      const contract = compileGitHubIssueGoalContract(payload, input.config, conversationId);
      const issueContext = [
        contract.goal,
        payload.issue.body?.trim(),
        `来源：${payload.issue.html_url}`,
        `验收条件：\n${contract.acceptanceCriteria.map((criterion) => `- ${criterion}`).join('\n')}`,
      ].filter(Boolean).join('\n\n');
      conversationRepo.create({
        id: conversationId,
        title,
        goal: issueContext,
        project_path: input.config.projectPath,
        git_repo_root: input.config.projectPath,
        use_worktree: true,
        team_pack_id: input.config.teamPackId,
        project_id: project.id,
        workspace_kind: 'workstream',
      });
      const snapshot = runtime.start(contract);
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
