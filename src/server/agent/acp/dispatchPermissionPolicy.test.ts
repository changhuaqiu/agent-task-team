import { describe, expect, it } from 'vitest';
import { resolveAcpDispatchPermissionPolicy } from './dispatchPermissionPolicy';

describe('resolveAcpDispatchPermissionPolicy', () => {
  it('allows an active autonomous run with explicit code-change authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      autonomous: { status: 'executing', allowCodeChanges: true },
    })).toBe('allow_once');
  });

  it.each(['completed', 'escalated', 'cancelled'] as const)(
    'does not reuse authorization from a %s autonomous run',
    (status) => {
      expect(resolveAcpDispatchPermissionPolicy({
        autonomous: { status, allowCodeChanges: true },
      })).toBe('deny');
    },
  );

  it('remains fail-closed without active authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({})).toBe('deny');
    expect(resolveAcpDispatchPermissionPolicy({
      autonomous: { status: 'executing', allowCodeChanges: false },
    })).toBe('deny');
  });

  it('preserves the explicit operator allow-once override', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      operatorMode: 'allow_once',
      autonomous: { status: 'cancelled', allowCodeChanges: false },
    })).toBe('allow_once');
  });

  it('lets an explicit operator deny override autonomous authorization', () => {
    expect(resolveAcpDispatchPermissionPolicy({
      operatorMode: 'deny',
      autonomous: { status: 'executing', allowCodeChanges: true },
    })).toBe('deny');
  });
});
