import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type {
  DeliveryActionReceipt,
  DeliveryFailureCode,
  DeliveryRunSnapshot,
} from './types';

interface ProviderCommandResult {
  stdout: string;
  stderr: string;
}

export type ProviderCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
) => Promise<ProviderCommandResult>;

interface ProviderIntegrationObservation {
  state: 'pending' | 'passed' | 'failed';
  receipt?: DeliveryActionReceipt;
  detail?: string;
}

export interface ProviderActionPort {
  integrate(snapshot: DeliveryRunSnapshot): Promise<DeliveryActionReceipt[]>;
  observeIntegration(snapshot: DeliveryRunSnapshot): Promise<ProviderIntegrationObservation>;
}

export class ProviderActionError extends Error {
  constructor(
    readonly failureCode: DeliveryFailureCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ProviderActionError';
  }
}

interface PullRequestView {
  number: number;
  url: string;
  state: string;
  headRefName: string;
  baseRefName: string;
  mergeCommit?: { oid?: string } | null;
}

interface GitHubContext {
  repoRoot: string;
  worktreePath: string;
  repository: string;
  headBranch: string;
  baseBranch: string;
}

const defaultRunner: ProviderCommandRunner = (command, args, options) => new Promise((resolve, reject) => {
  execFile(command, args, {
    cwd: options.cwd,
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  }, (error, stdout, stderr) => {
    if (error) {
      reject(Object.assign(error, { stdout: String(stdout), stderr: String(stderr) }));
      return;
    }
    resolve({ stdout: String(stdout), stderr: String(stderr) });
  });
});

function normalizedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(normalizedPath(parent), normalizedPath(child));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function parseGitHubRepository(remote: string): string | undefined {
  const normalized = remote.trim().replace(/\.git$/i, '');
  const https = /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i.exec(normalized);
  if (https) return https[1];
  const ssh = /^git@github\.com:([^/]+\/[^/]+)$/i.exec(normalized);
  return ssh?.[1];
}

function parsePullRequest(value: unknown): PullRequestView {
  const row = value as Partial<PullRequestView>;
  if (
    !Number.isSafeInteger(Number(row.number))
    || Number(row.number) <= 0
    || typeof row.url !== 'string'
    || typeof row.state !== 'string'
    || typeof row.headRefName !== 'string'
    || typeof row.baseRefName !== 'string'
  ) {
    throw new ProviderActionError('transient_provider', 'GitHub 返回了无法验证的 Pull Request 数据', true);
  }
  return {
    number: Number(row.number),
    url: row.url,
    state: row.state.toUpperCase(),
    headRefName: row.headRefName,
    baseRefName: row.baseRefName,
    mergeCommit: row.mergeCommit,
  };
}

function classifyCommandError(error: unknown): ProviderActionError {
  const value = error as {
    code?: string;
    killed?: boolean;
    signal?: string;
    message?: string;
    stderr?: string;
  };
  const text = `${value?.message ?? ''}\n${value?.stderr ?? ''}`.toLowerCase();
  if (value?.code === 'ENOENT') {
    return new ProviderActionError('permanent_configuration', 'Git 或 GitHub CLI 未安装');
  }
  if (/auth|login|permission|forbidden|http 401|http 403/.test(text)) {
    return new ProviderActionError('missing_authorization', 'GitHub 授权不足，无法完成外部交付动作');
  }
  if (value?.killed || value?.signal === 'SIGTERM' || /timed?\s*out/.test(text)) {
    return new ProviderActionError('transient_provider', 'GitHub 状态查询超时', true);
  }
  return new ProviderActionError('transient_provider', 'GitHub 外部动作暂时失败', true);
}

function providerPayload(context: GitHubContext, pullRequest: PullRequestView): Record<string, unknown> {
  return {
    provider: 'github',
    repository: context.repository,
    number: pullRequest.number,
    url: pullRequest.url,
    state: pullRequest.state,
    headBranch: pullRequest.headRefName,
    baseBranch: pullRequest.baseRefName,
    mergeCommit: pullRequest.mergeCommit?.oid,
  };
}

export class GitHubProviderActionAdapter implements ProviderActionPort {
  constructor(
    private readonly runCommand: ProviderCommandRunner = defaultRunner,
    private readonly timeoutMs = 15_000,
  ) {}

  async integrate(snapshot: DeliveryRunSnapshot): Promise<DeliveryActionReceipt[]> {
    const { authorization } = snapshot.contract;
    if (!authorization.allowPush || !authorization.allowPullRequest || !authorization.allowAutoMerge) {
      throw new ProviderActionError(
        'missing_authorization',
        '当前目标没有授权 push、创建 Pull Request 和自动合并',
      );
    }

    const context = await this.resolveContext(snapshot);
    await this.assertCleanCommittedWorktree(context);
    await this.run('git', ['push', '--set-upstream', 'origin', context.headBranch], context.worktreePath);

    let pullRequest = await this.findPullRequest(context);
    if (!pullRequest) {
      await this.run('gh', [
        'pr',
        'create',
        '--repo',
        context.repository,
        '--head',
        context.headBranch,
        '--base',
        context.baseBranch,
        '--title',
        snapshot.contract.goal.slice(0, 120),
        '--body',
        this.pullRequestBody(snapshot),
      ], context.worktreePath);
      pullRequest = await this.viewPullRequest(context, context.headBranch);
    }
    this.assertExpectedPullRequest(context, pullRequest);

    if (pullRequest.state === 'MERGED') {
      return [this.mergedReceipt(snapshot, context, pullRequest)];
    }
    if (pullRequest.state !== 'OPEN') {
      throw new ProviderActionError('policy_denied', '已有 Pull Request 已关闭且未合并');
    }

    await this.run('gh', [
      'pr',
      'merge',
      String(pullRequest.number),
      '--repo',
      context.repository,
      '--auto',
      '--merge',
    ], context.worktreePath);
    pullRequest = await this.viewPullRequest(context, String(pullRequest.number));
    this.assertExpectedPullRequest(context, pullRequest);

    if (pullRequest.state === 'MERGED') {
      return [this.mergedReceipt(snapshot, context, pullRequest)];
    }
    return [{
      kind: 'provider.github.pull_request.merge_requested',
      status: 'succeeded',
      externalId: String(pullRequest.number),
      payload: providerPayload(context, pullRequest),
      idempotencyKey: `${snapshot.run.id}:github:pr:${pullRequest.number}:merge-requested`,
    }];
  }

  async observeIntegration(snapshot: DeliveryRunSnapshot): Promise<ProviderIntegrationObservation> {
    const merged = snapshot.receipts.find((receipt) =>
      receipt.kind === 'provider.github.pull_request.merged'
      && receipt.status === 'succeeded'
    );
    if (merged) return { state: 'passed' };

    const requested = [...snapshot.receipts].reverse().find((receipt) =>
      receipt.kind === 'provider.github.pull_request.merge_requested'
      && receipt.status === 'succeeded'
    );
    if (!requested?.external_id) return { state: 'failed', detail: '尚未创建可观察的 Pull Request' };

    try {
      const context = await this.resolveContext(snapshot);
      const pullRequest = await this.viewPullRequest(context, requested.external_id);
      this.assertExpectedPullRequest(context, pullRequest);
      if (pullRequest.state === 'MERGED') {
        return {
          state: 'passed',
          receipt: this.mergedReceipt(snapshot, context, pullRequest),
        };
      }
      if (pullRequest.state === 'OPEN') return { state: 'pending' };
      return { state: 'failed', detail: 'Pull Request 已关闭但没有合并' };
    } catch (error) {
      const providerError = error instanceof ProviderActionError
        ? error
        : classifyCommandError(error);
      if (providerError.retryable) return { state: 'pending', detail: providerError.message };
      return { state: 'failed', detail: providerError.message };
    }
  }

  private async resolveContext(snapshot: DeliveryRunSnapshot): Promise<GitHubContext> {
    const configuredPath = snapshot.contract.scope.repository
      ?? snapshot.contract.scope.projectPath;
    if (!configuredPath) {
      throw new ProviderActionError('permanent_configuration', '自主交付没有配置 Git 仓库目录');
    }
    if (!/^[A-Za-z0-9._-]+$/.test(snapshot.run.conversation_id)) {
      throw new ProviderActionError('policy_denied', '项目标识不能安全映射到 worktree');
    }

    let configuredRoot = path.resolve(configuredPath);
    if (this.runCommand === defaultRunner) {
      if (!existsSync(configuredRoot) || !statSync(configuredRoot).isDirectory()) {
        throw new ProviderActionError('permanent_configuration', '配置的 Git 仓库目录不存在');
      }
      configuredRoot = realpathSync(configuredRoot);
    }
    const rootResult = await this.run('git', ['rev-parse', '--show-toplevel'], configuredRoot);
    const repoRoot = path.resolve(rootResult.stdout.trim());
    if (normalizedPath(repoRoot) !== normalizedPath(configuredRoot)) {
      throw new ProviderActionError('policy_denied', '配置目录必须是授权仓库的根目录');
    }

    const expectedWorktree = path.join(repoRoot, '.worktrees', snapshot.run.conversation_id);
    let worktreePath = expectedWorktree;
    if (this.runCommand === defaultRunner) {
      if (!existsSync(expectedWorktree) || !statSync(expectedWorktree).isDirectory()) {
        throw new ProviderActionError('permanent_configuration', '没有找到自主执行使用的 Git worktree');
      }
      worktreePath = realpathSync(expectedWorktree);
    }
    if (!isInside(path.join(repoRoot, '.worktrees'), worktreePath)) {
      throw new ProviderActionError('policy_denied', 'worktree 超出了授权仓库范围');
    }

    const headBranch = (await this.run(
      'git',
      ['branch', '--show-current'],
      worktreePath,
    )).stdout.trim();
    const expectedHead = `worktree/${snapshot.run.conversation_id}`;
    if (headBranch !== expectedHead) {
      throw new ProviderActionError('policy_denied', '当前 worktree 分支与自主交付项目不匹配');
    }

    const allowedBranches = snapshot.contract.authorization.allowedBranches ?? [];
    const baseBranch = allowedBranches.includes('main')
      ? 'main'
      : (allowedBranches[0] ?? 'main');
    await this.run('git', ['check-ref-format', '--branch', baseBranch], worktreePath);

    const remote = await this.run(
      'git',
      ['config', '--get', 'remote.origin.url'],
      worktreePath,
    );
    const repository = parseGitHubRepository(remote.stdout);
    if (!repository) {
      throw new ProviderActionError('permanent_configuration', 'origin 不是受支持的 GitHub 仓库');
    }
    return { repoRoot, worktreePath, repository, headBranch, baseBranch };
  }

  private async assertCleanCommittedWorktree(context: GitHubContext): Promise<void> {
    const status = await this.run('git', ['status', '--porcelain'], context.worktreePath);
    if (status.stdout.trim()) {
      throw new ProviderActionError('verification_failed', 'worktree 仍有未提交变更，不能创建 Pull Request');
    }
    const ahead = await this.run(
      'git',
      ['rev-list', '--count', `${context.baseBranch}..HEAD`],
      context.worktreePath,
    );
    if (!Number.isSafeInteger(Number(ahead.stdout.trim())) || Number(ahead.stdout.trim()) < 1) {
      throw new ProviderActionError('verification_failed', '交付分支没有可合并的提交');
    }
  }

  private async findPullRequest(context: GitHubContext): Promise<PullRequestView | undefined> {
    const result = await this.run('gh', [
      'pr',
      'list',
      '--repo',
      context.repository,
      '--head',
      context.headBranch,
      '--base',
      context.baseBranch,
      '--state',
      'all',
      '--json',
      'number,url,state,headRefName,baseRefName,mergeCommit',
      '--limit',
      '1',
    ], context.worktreePath);
    const rows = JSON.parse(result.stdout || '[]') as unknown[];
    return rows[0] ? parsePullRequest(rows[0]) : undefined;
  }

  private async viewPullRequest(context: GitHubContext, selector: string): Promise<PullRequestView> {
    const result = await this.run('gh', [
      'pr',
      'view',
      selector,
      '--repo',
      context.repository,
      '--json',
      'number,url,state,headRefName,baseRefName,mergeCommit',
    ], context.worktreePath);
    return parsePullRequest(JSON.parse(result.stdout));
  }

  private assertExpectedPullRequest(context: GitHubContext, pullRequest: PullRequestView): void {
    if (
      pullRequest.headRefName !== context.headBranch
      || pullRequest.baseRefName !== context.baseBranch
    ) {
      throw new ProviderActionError('policy_denied', 'Pull Request 的源分支或目标分支超出授权范围');
    }
  }

  private mergedReceipt(
    snapshot: DeliveryRunSnapshot,
    context: GitHubContext,
    pullRequest: PullRequestView,
  ): DeliveryActionReceipt {
    return {
      kind: 'provider.github.pull_request.merged',
      status: 'succeeded',
      externalId: String(pullRequest.number),
      payload: providerPayload(context, pullRequest),
      idempotencyKey: `${snapshot.run.id}:github:pr:${pullRequest.number}:merged`,
    };
  }

  private pullRequestBody(snapshot: DeliveryRunSnapshot): string {
    return [
      '## 自主交付目标',
      snapshot.contract.goal,
      '',
      '## 验收标准',
      ...snapshot.contract.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      '',
      `Delivery Run: ${snapshot.run.id}`,
    ].join('\n');
  }

  private async run(command: string, args: string[], cwd: string): Promise<ProviderCommandResult> {
    try {
      return await this.runCommand(command, args, { cwd, timeoutMs: this.timeoutMs });
    } catch (error) {
      if (error instanceof ProviderActionError) throw error;
      throw classifyCommandError(error);
    }
  }
}
