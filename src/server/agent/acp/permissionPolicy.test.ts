import { describe, expect, it } from 'vitest';
import { createCorrelatedPlatformMcpPermissionPolicy, createPermissionHandler } from './permissionPolicy';
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
});
