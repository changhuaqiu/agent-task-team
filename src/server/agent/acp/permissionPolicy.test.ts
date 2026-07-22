import { describe, expect, it } from 'vitest';
import {
  CorrelatedPlatformMcpApprovalTracker,
  createCorrelatedPlatformMcpPermissionPolicy,
  createPermissionHandler,
  normalizeAcpMcpToolName,
} from './permissionPolicy';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';

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

describe('ACP permission policy', () => {
  it('normalizes only the Claude ACP spelling of a platform MCP tool name', () => {
    expect(normalizeAcpMcpToolName('mcp__agent-task-team-a1b2__task_create'))
      .toBe('mcp.agent-task-team-a1b2.task_create');
    expect(normalizeAcpMcpToolName('mcp.agent-task-team-a1b2.task_create'))
      .toBe('mcp.agent-task-team-a1b2.task_create');
    expect(normalizeAcpMcpToolName('mcp__untrusted server__task_create'))
      .toBe('mcp__untrusted server__task_create');
  });

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

  it('allows only a same-session one-shot platform MCP approval without adapter-specific metadata', async () => {
    const approvals = new CorrelatedPlatformMcpApprovalTracker();
    approvals.observe('session-1', 'platform-call', true);
    const policy = createCorrelatedPlatformMcpPermissionPolicy('deny', approvals);
    const platformRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call', title: undefined },
    } as RequestPermissionRequest;
    const replayedRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call', title: undefined },
    } as RequestPermissionRequest;
    const otherMcpServer = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'other-call', title: undefined },
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

  it('does not let a different session consume an armed call id', async () => {
    const approvals = new CorrelatedPlatformMcpApprovalTracker();
    approvals.observe('session-1', 'platform-call', true);
    const policy = createCorrelatedPlatformMcpPermissionPolicy('deny', approvals);
    const wrongSession = {
      ...request,
      sessionId: 'session-2',
      toolCall: { ...request.toolCall, toolCallId: 'platform-call' },
    } as RequestPermissionRequest;
    const correctSession = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call' },
    } as RequestPermissionRequest;

    await expect(createPermissionHandler(policy)(wrongSession)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });
    await expect(createPermissionHandler(policy)(correctSession)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('lets an operator hard deny override a correlated platform MCP approval', async () => {
    const approvals = new CorrelatedPlatformMcpApprovalTracker();
    approvals.observe('session-1', 'platform-call', true);
    const platformRequest = {
      ...request,
      toolCall: { ...request.toolCall, toolCallId: 'platform-call' },
    } as RequestPermissionRequest;

    const hardDeny = createCorrelatedPlatformMcpPermissionPolicy(
      'deny',
      approvals,
      { hardDeny: true },
    );
    await expect(createPermissionHandler(hardDeny)(platformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'reject' },
    });

    const normalPolicy = createCorrelatedPlatformMcpPermissionPolicy('deny', approvals);
    await expect(createPermissionHandler(normalPolicy)(platformRequest)).resolves.toEqual({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    });
  });

  it('permanently invalidates a repeated or conflicting tool call id', async () => {
    const replayed = new CorrelatedPlatformMcpApprovalTracker();
    replayed.observe('session-1', 'replayed-call', true);
    expect(replayed.consume('session-1', 'replayed-call')).toBe(true);
    replayed.observe('session-1', 'replayed-call', true);
    expect(replayed.consume('session-1', 'replayed-call')).toBe(false);

    const conflicting = new CorrelatedPlatformMcpApprovalTracker();
    conflicting.observe('session-1', 'conflicting-call', true);
    conflicting.observe('session-1', 'conflicting-call', false);
    expect(conflicting.consume('session-1', 'conflicting-call')).toBe(false);
  });
});
