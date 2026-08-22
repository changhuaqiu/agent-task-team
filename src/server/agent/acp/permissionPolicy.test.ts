import { describe, expect, it } from 'vitest';
import {
  createCorrelatedPlatformMcpPermissionPolicy,
  createPermissionHandler,
  createWorkContractPermissionPolicy,
} from './permissionPolicy';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { WorkContract } from '../../work-contract/types';

const request = {
  sessionId: 'session-1',
  toolCall: {
    toolCallId: 'tool-1',
    title: 'edit file',
    kind: 'edit',
    status: 'pending',
  },
  options: [
    { kind: 'allow_once', name: 'Allow once', optionId: 'allow-once' },
    { kind: 'allow_always', name: 'Always allow', optionId: 'allow-always' },
    { kind: 'reject_once', name: 'Reject', optionId: 'reject' },
  ],
} as RequestPermissionRequest;

function createTestWorkContractPolicy(input: {
  permissions: unknown;
  cwd: string;
  engine: Parameters<typeof createWorkContractPermissionPolicy>[0]['engine'];
  isAuthorityActive: () => boolean;
  hasAcceptedOutcome?: () => boolean;
}) {
  const workContract = {
    contractId: 'test-contract',
    workId: 'test-work',
    workEpoch: 1,
    projectId: 'test-project',
    permissions: input.permissions,
  } as WorkContract;
  return createWorkContractPermissionPolicy({
    workContract,
    cwd: input.cwd,
    engine: input.engine,
    authorityReader: () => input.isAuthorityActive() ? {
      work_id: workContract.workId,
      project_id: workContract.projectId,
      current_epoch: workContract.workEpoch,
      current_contract_id: workContract.contractId,
      status: 'active',
      revision: 0,
      updated_at: new Date().toISOString(),
      closed_at: null,
    } : undefined,
    acceptedOutcomeReader: () => input.hasAcceptedOutcome?.() ?? false,
  });
}

describe('ACP permission policy', () => {
  it('denies by default', async () => {
    await expect(createPermissionHandler()(request)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('selects allow_once only when explicitly configured', async () => {
    await expect(createPermissionHandler('allow_once')(request)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('maps an autonomous WorkContract to project-scoped one-shot edits and execution', async () => {
    const cwd = process.cwd();
    const policy = createTestWorkContractPolicy({
      cwd,
      engine: 'claude',
      isAuthorityActive: () => true,
      permissions: {
        authorization: {
          allowCodeChanges: true,
          allowPush: false,
          allowPullRequest: false,
          allowAutoMerge: false,
        },
      },
    });
    const decide = (toolCall: RequestPermissionRequest['toolCall']) =>
      createPermissionHandler(policy)({ ...request, toolCall });

    await expect(decide({
      ...request.toolCall,
      toolCallId: 'write-project-file',
      kind: 'edit',
      rawInput: { file_path: 'src/index.ts', content: 'export {}' },
    })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    await expect(decide({
      ...request.toolCall,
      toolCallId: 'run-tests',
      kind: 'execute',
      rawInput: { command: 'node --test src/server/agent/acp/permissionPolicy.test.ts' },
    })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    await expect(decide({
      ...request.toolCall,
      toolCallId: 'native-subagent',
      kind: 'think',
      rawInput: { prompt: 'review this implementation' },
    })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
  });

  it('allows only constrained Playwright tests when the execution profile requires browser verification', async () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'ath-browser-policy-'));
    try {
      const policy = createTestWorkContractPolicy({
        permissions: {
          authorization: { allowCodeChanges: false },
          executionProfile: { capabilities: ['browser_verification'] },
        },
        cwd,
        engine: 'codex',
        isAuthorityActive: () => true,
      });
      const decide = (command: string) => createPermissionHandler(policy)({
        ...request,
        toolCall: {
          ...request.toolCall,
          toolCallId: command,
          kind: 'execute',
          rawInput: { command },
        },
      });

      await expect(decide('pnpm exec playwright test e2e/voice.spec.ts')).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      });
      await expect(decide('npx --no-install playwright test --config=playwright.config.ts')).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      });
      await expect(decide('node -e "require(\'playwright\')"')).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
      await expect(decide('pnpm exec playwright test && git push')).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reads Codex file-change grantRoot metadata while preserving project containment', async () => {
    const cwd = mkdtempSync(resolve(tmpdir(), 'ath-codex-edit-policy-'));
    const outside = mkdtempSync(resolve(tmpdir(), 'ath-codex-edit-outside-'));
    try {
      const policy = createTestWorkContractPolicy({
        permissions: { authorization: { allowCodeChanges: true } },
        cwd,
        engine: 'codex',
        isAuthorityActive: () => true,
      });
      const decide = (grantRoot: string) => createPermissionHandler(policy)({
        ...request,
        toolCall: { ...request.toolCall, toolCallId: grantRoot, kind: 'edit', rawInput: undefined },
        _meta: { codex: { params: { grantRoot } } },
      });

      await expect(decide(cwd)).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'allow-once' },
      });
      await expect(decide(outside)).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('keeps project and external-effect boundaries when code changes are authorized', async () => {
    const cwd = process.cwd();
    const policy = createTestWorkContractPolicy({
      cwd,
      engine: 'claude',
      isAuthorityActive: () => true,
      permissions: { authorization: { allowCodeChanges: true } },
    });
    const decide = (toolCall: RequestPermissionRequest['toolCall']) =>
      createPermissionHandler(policy)({ ...request, toolCall });

    for (const toolCall of [
      {
        ...request.toolCall,
        toolCallId: 'outside-edit',
        kind: 'edit' as const,
        rawInput: { file_path: resolve(cwd, '..', 'outside-project', 'secret.ts'), content: 'x' },
      },
      {
        ...request.toolCall,
        toolCallId: 'push',
        kind: 'execute' as const,
        rawInput: { command: 'git push origin HEAD' },
      },
      {
        ...request.toolCall,
        toolCallId: 'pull-request',
        kind: 'execute' as const,
        rawInput: { command: 'gh pr create --fill' },
      },
      {
        ...request.toolCall,
        toolCallId: 'merge',
        kind: 'execute' as const,
        rawInput: { command: 'git merge feature' },
      },
    ]) {
      await expect(decide(toolCall)).resolves.toEqual({
        outcome: { outcome: 'selected', optionId: 'reject' },
      });
    }
  });

  it('never infers external Git delivery effects from generic shell execution', async () => {
    const policy = createTestWorkContractPolicy({
      cwd: process.cwd(),
      engine: 'claude',
      isAuthorityActive: () => true,
      permissions: {
        authorization: {
          allowCodeChanges: true,
          allowPush: true,
          allowPullRequest: true,
          allowAutoMerge: true,
        },
      },
    });
    for (const command of [
      'git push origin HEAD',
      'git -C . push origin HEAD',
      'git send-pack origin HEAD',
      'gh pr create --fill',
      'gh api repos/acme/repo/pulls',
      'curl https://api.github.com/repos/acme/repo/pulls',
      'npm test && git push origin HEAD',
      'node -e "require(\'child_process\').execSync(\'git push\')"',
    ]) {
      await expect(createPermissionHandler(policy)({
        ...request,
        toolCall: {
          ...request.toolCall,
          toolCallId: command,
          kind: 'execute',
          rawInput: { command },
        },
      })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    }
  });

  it('does not infer autonomous permission without an explicit code-change grant', async () => {
    const policy = createTestWorkContractPolicy({
      cwd: process.cwd(),
      engine: 'claude',
      isAuthorityActive: () => true,
      permissions: { authorization: { allowCodeChanges: false } },
    });
    await expect(createPermissionHandler(policy)({
      ...request,
      toolCall: {
        ...request.toolCall,
        rawInput: { file_path: 'src/index.ts', content: 'x' },
      },
    })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
  });

  it('rejects edits that escape through a project-local junction', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'ath-permission-path-'));
    const cwd = resolve(root, 'project');
    const outside = resolve(root, 'outside');
    mkdirSync(cwd);
    mkdirSync(outside);
    symlinkSync(outside, resolve(cwd, 'linked-outside'), 'junction');
    try {
      const policy = createTestWorkContractPolicy({
        cwd,
        engine: 'claude',
        isAuthorityActive: () => true,
        permissions: { authorization: { allowCodeChanges: true } },
      });
      await expect(createPermissionHandler(policy)({
        ...request,
        toolCall: {
          ...request.toolCall,
          rawInput: { file_path: 'linked-outside/escape.ts', content: 'x' },
        },
      })).resolves.toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rechecks WorkContract authority before every one-shot decision', async () => {
    let active = true;
    const workContract = {
      contractId: 'contract-1',
      workId: 'work-1',
      workEpoch: 3,
      projectId: 'project-1',
      permissions: { authorization: { allowCodeChanges: true } },
    } as WorkContract;
    const policy = createWorkContractPermissionPolicy({
      workContract,
      cwd: process.cwd(),
      engine: 'claude',
      authorityReader: () => active ? {
        work_id: 'work-1',
        project_id: 'project-1',
        current_epoch: 3,
        current_contract_id: 'contract-1',
        status: 'active',
        revision: 0,
        updated_at: new Date().toISOString(),
        closed_at: null,
      } : {
        work_id: 'work-1',
        project_id: 'project-1',
        current_epoch: 4,
        current_contract_id: 'contract-2',
        status: 'active',
        revision: 1,
        updated_at: new Date().toISOString(),
        closed_at: null,
      },
    });
    const editRequest = {
      ...request,
      toolCall: {
        ...request.toolCall,
        rawInput: { file_path: 'src/index.ts', content: 'x' },
      },
    } as RequestPermissionRequest;

    await expect(createPermissionHandler(policy)(editRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    active = false;
    await expect(createPermissionHandler(policy)(editRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('denies native side effects after the WorkContract exit is accepted', async () => {
    let exitAccepted = false;
    const policy = createTestWorkContractPolicy({
      cwd: process.cwd(),
      engine: 'claude',
      isAuthorityActive: () => true,
      hasAcceptedOutcome: () => exitAccepted,
      permissions: { authorization: { allowCodeChanges: true } },
    });
    const editRequest = {
      ...request,
      toolCall: {
        ...request.toolCall,
        rawInput: { file_path: 'src/index.ts', content: 'x' },
      },
    } as RequestPermissionRequest;

    await expect(createPermissionHandler(policy)(editRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    exitAccepted = true;
    await expect(createPermissionHandler(policy)(editRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('fails closed when a policy throws', async () => {
    const handler = createPermissionHandler(() => {
      throw new Error('policy unavailable');
    });
    await expect(handler(request)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('fails closed when a policy does not answer before its deadline', async () => {
    const handler = createPermissionHandler(
      () => new Promise(() => {}),
      10,
    );
    await expect(handler(request)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('fails closed when allow_once is unavailable', async () => {
    const noOneShotAllow = {
      ...request,
      options: request.options.filter((option) => option.kind !== 'allow_once'),
    } as RequestPermissionRequest;
    await expect(createPermissionHandler('allow_once')(noOneShotAllow)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('allows only a correlated one-shot platform MCP approval', async () => {
    const policy = createCorrelatedPlatformMcpPermissionPolicy('deny', new Set(['platform-call']));
    const platformRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call', title: undefined },
      _meta: { is_mcp_tool_approval: true },
    } as RequestPermissionRequest;
    const replayedRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call', title: undefined },
      _meta: { is_mcp_tool_approval: true },
    } as RequestPermissionRequest;
    const otherMcpServer = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'other-call', title: undefined },
      _meta: { is_mcp_tool_approval: true },
    } as RequestPermissionRequest;

    await expect(createPermissionHandler(policy)(platformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    await expect(createPermissionHandler(policy)(replayedRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
    await expect(createPermissionHandler(policy)(otherMcpServer)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('allows a correlated platform MCP approval when permission arrives before the tool update', async () => {
    const approvedToolCallIds = new Set<string>();
    const policy = createCorrelatedPlatformMcpPermissionPolicy('deny', approvedToolCallIds);
    const platformRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'racing-platform-call', title: undefined },
      _meta: { is_mcp_tool_approval: true },
    } as RequestPermissionRequest;

    setTimeout(() => approvedToolCallIds.add('racing-platform-call'), 10);

    await expect(createPermissionHandler(policy)(platformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    await expect(createPermissionHandler(policy)(platformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });

  it('allows an exact scoped platform MCP title when the adapter omits MCP metadata', async () => {
    const toolName = 'mcp__agent-task-team-random__task_update_status';
    const policy = createCorrelatedPlatformMcpPermissionPolicy(
      'deny',
      new Set(),
      new Set([toolName]),
    );
    const exactPlatformRequest = {
      ...request,
      toolCall: {
        ...request.toolCall,
        toolCallId: 'title-matched-call',
        title: toolName,
        kind: 'other',
      },
    } as RequestPermissionRequest;
    const unknownToolRequest = {
      ...exactPlatformRequest,
      toolCall: {
        ...exactPlatformRequest.toolCall,
        toolCallId: 'unknown-call',
        title: 'mcp__agent-task-team-random__task_assign',
      },
    } as RequestPermissionRequest;

    await expect(createPermissionHandler(policy)(exactPlatformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
    await expect(createPermissionHandler(policy)(exactPlatformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
    await expect(createPermissionHandler(policy)(unknownToolRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
  });
});
