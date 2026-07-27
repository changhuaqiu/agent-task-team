import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  GitHubProviderActionAdapter,
  ProviderActionError,
  type ProviderCommandRunner,
} from './provider-actions';
import type { DeliveryRunSnapshot } from './types';

function snapshot(overrides?: Partial<DeliveryRunSnapshot['contract']['authorization']>): DeliveryRunSnapshot {
  return {
    run: {
      id: 'delivery-provider',
      conversation_id: 'conv-provider',
      root_task_id: 'task-provider',
      status: 'active',
      current_stage: 'integrating',
      goal_contract_json: '{}',
      repair_cycle: 0,
      revision: 0,
      escalation_code: null,
      escalation_detail: null,
      delivery_bundle_json: null,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
      completed_at: null,
    },
    contract: {
      goal: '交付 Provider Gateway',
      acceptanceCriteria: ['Pull Request 最终合并'],
      scope: {
        conversationId: 'conv-provider',
        repository: path.resolve('C:/provider-repo'),
      },
      authorization: {
        allowCodeChanges: true,
        allowPush: true,
        allowPullRequest: true,
        allowAutoMerge: true,
        allowedBranches: ['main'],
        ...overrides,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 3,
        maxRepairCycles: 2,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: true,
        requireMerge: true,
      },
    },
    actions: [],
    attempts: [],
    receipts: [],
  };
}

function pullRequest(state: 'OPEN' | 'MERGED') {
  return {
    number: 42,
    url: 'https://github.com/example/repo/pull/42',
    state,
    headRefName: 'worktree/conv-provider',
    baseRefName: 'main',
    mergeCommit: state === 'MERGED' ? { oid: 'abc123' } : null,
  };
}

function runnerFor(input: {
  list?: unknown[];
  views?: Array<ReturnType<typeof pullRequest>>;
}): ProviderCommandRunner {
  const views = [...(input.views ?? [])];
  return vi.fn(async (command, args) => {
    if (command === 'git' && args.join(' ') === 'rev-parse --show-toplevel') {
      return { stdout: path.resolve('C:/provider-repo'), stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'branch --show-current') {
      return { stdout: 'worktree/conv-provider\n', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'config --get remote.origin.url') {
      return { stdout: 'git@github.com:example/repo.git\n', stderr: '' };
    }
    if (command === 'git' && args.join(' ') === 'status --porcelain') {
      return { stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'rev-list') {
      return { stdout: '1\n', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') {
      return { stdout: JSON.stringify(input.list ?? []), stderr: '' };
    }
    if (command === 'gh' && args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify(views.shift() ?? pullRequest('OPEN')), stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
}

describe('GitHubProviderActionAdapter', () => {
  it('复用已经合并的 PR，并生成稳定的终态回执', async () => {
    const runCommand = runnerFor({ list: [pullRequest('MERGED')] });
    const adapter = new GitHubProviderActionAdapter(runCommand);

    const receipts = await adapter.integrate(snapshot());

    expect(receipts).toEqual([expect.objectContaining({
      kind: 'provider.github.pull_request.merged',
      externalId: '42',
      idempotencyKey: 'delivery-provider:github:pr:42:merged',
    })]);
    expect(runCommand).not.toHaveBeenCalledWith(
      'gh',
      expect.arrayContaining(['merge']),
      expect.anything(),
    );
  });

  it('创建 PR、请求自动合并，并在 reconcile 时观察最终合并事实', async () => {
    const runCommand = runnerFor({
      list: [],
      views: [pullRequest('OPEN'), pullRequest('OPEN'), pullRequest('MERGED')],
    });
    const adapter = new GitHubProviderActionAdapter(runCommand);
    const current = snapshot();

    const requested = await adapter.integrate(current);
    expect(requested[0]).toMatchObject({
      kind: 'provider.github.pull_request.merge_requested',
      externalId: '42',
    });

    current.receipts.push({
      id: 'receipt-requested',
      run_id: current.run.id,
      action_id: null,
      attempt_id: null,
      kind: requested[0].kind,
      external_id: requested[0].externalId ?? null,
      status: requested[0].status,
      payload_json: JSON.stringify(requested[0].payload ?? {}),
      idempotency_key: requested[0].idempotencyKey!,
      observed_at: '2026-07-19T00:01:00.000Z',
    });
    const observed = await adapter.observeIntegration(current);

    expect(observed.state).toBe('passed');
    expect(observed.receipt).toMatchObject({
      kind: 'provider.github.pull_request.merged',
      externalId: '42',
    });
  });

  it('没有完整授权时不会执行任何外部命令', async () => {
    const runCommand = runnerFor({});
    const adapter = new GitHubProviderActionAdapter(runCommand);

    await expect(adapter.integrate(snapshot({ allowAutoMerge: false })))
      .rejects.toMatchObject<Partial<ProviderActionError>>({
        failureCode: 'missing_authorization',
        retryable: false,
      });
    expect(runCommand).not.toHaveBeenCalled();
  });
});
