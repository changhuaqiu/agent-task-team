import { describe, expect, it } from 'vitest';
import type { RequestPermissionRequest } from '@agentclientprotocol/sdk';
import {
  createAcpDispatchPermissionPolicy,
  resolveAcpDispatchPermissionPolicy,
  type AcpDispatchAuthorization,
} from './dispatchPermissionPolicy';

const activeAuthorization: AcpDispatchAuthorization = {
  runId: 'run-1',
  conversationId: 'conv-1',
  status: 'executing',
  allowCodeChanges: true,
};

const permissionRequest = {} as RequestPermissionRequest;

describe('resolveAcpDispatchPermissionPolicy', () => {
  it('allows an active autonomous run with explicit code-change authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      deliveryRunId: 'run-1',
      conversationId: 'conv-1',
      autonomous: activeAuthorization,
    })).toBe('allow_once');
  });

  it.each(['completed', 'escalated', 'cancelled'] as const)(
    'does not reuse authorization from a %s autonomous run',
    (status) => {
      expect(resolveAcpDispatchPermissionPolicy({
        deliveryRunId: 'run-1',
        conversationId: 'conv-1',
        autonomous: { ...activeAuthorization, status },
      })).toBe('deny');
    },
  );

  it('remains fail-closed without active authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({})).toBe('deny');
    expect(resolveAcpDispatchPermissionPolicy({
      deliveryRunId: 'run-1',
      conversationId: 'conv-1',
      autonomous: { ...activeAuthorization, allowCodeChanges: false },
    })).toBe('deny');
  });

  it('does not let a same-conversation manual invocation inherit an autonomous run', async () => {
    const getAuthorization = () => activeAuthorization;
    const policy = createAcpDispatchPermissionPolicy({
      conversationId: 'conv-1',
      getAuthorization,
    });
    expect(typeof policy).toBe('function');
    expect(await (policy as Exclude<typeof policy, string>)(permissionRequest)).toBe('deny');
  });

  it.each([
    ['wrong run', { ...activeAuthorization, runId: 'run-2' }],
    ['wrong conversation', { ...activeAuthorization, conversationId: 'conv-2' }],
  ])('rejects an authorization bound to the %s', async (_label, authorization) => {
    const policy = createAcpDispatchPermissionPolicy({
      deliveryRunId: 'run-1',
      conversationId: 'conv-1',
      getAuthorization: () => authorization,
    });
    expect(await (policy as Exclude<typeof policy, string>)(permissionRequest)).toBe('deny');
  });

  it('rechecks run state for every request and revokes after cancellation', async () => {
    let authorization = activeAuthorization;
    const policy = createAcpDispatchPermissionPolicy({
      deliveryRunId: 'run-1',
      conversationId: 'conv-1',
      getAuthorization: () => authorization,
    });
    const decide = policy as Exclude<typeof policy, string>;

    expect(await decide(permissionRequest)).toBe('allow_once');
    authorization = { ...authorization, status: 'cancelled' };
    expect(await decide(permissionRequest)).toBe('deny');
  });

  it('preserves the explicit operator allow-once override', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      operatorMode: 'allow_once',
      autonomous: { ...activeAuthorization, status: 'cancelled', allowCodeChanges: false },
    })).toBe('allow_once');
  });

  it('lets an explicit operator deny override autonomous authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      operatorMode: 'deny',
      deliveryRunId: 'run-1',
      conversationId: 'conv-1',
      autonomous: activeAuthorization,
    })).toBe('deny');
  });
});
