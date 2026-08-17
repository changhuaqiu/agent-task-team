import { describe, expect, it } from 'vitest';
import { buildWorkIdentity, hasWorkPurpose, parseWorkIdentity } from './work-identity';

describe('work identity', () => {
  it('round-trips a Gate-scoped review cycle', () => {
    const workId = buildWorkIdentity({
      scope: 'task',
      targetId: 'task-1',
      agentId: 'reviewer',
      gateId: 'gate-2',
      purpose: 'review',
    });

    expect(workId).toBe('task:task-1:agent:reviewer:gate:gate-2:purpose:review');
    expect(parseWorkIdentity(workId)).toEqual({
      scope: 'task',
      targetId: 'task-1',
      agentId: 'reviewer',
      gateId: 'gate-2',
      purpose: 'review',
    });
    expect(hasWorkPurpose(workId, 'review')).toBe(true);
  });

  it('keeps legacy non-Gate identities readable during migration', () => {
    expect(parseWorkIdentity('task:task-1:agent:mario:purpose:execute')).toEqual({
      scope: 'task',
      targetId: 'task-1',
      agentId: 'mario',
      purpose: 'execute',
    });
  });

  it('rejects ambiguous segments and unrelated work identifiers', () => {
    expect(() => buildWorkIdentity({
      scope: 'delivery',
      targetId: 'delivery:unsafe',
      agentId: 'reviewer',
      purpose: 'verify',
    })).toThrow('invalid_work_identity_target');
    expect(parseWorkIdentity('request-gate:task-1:code_review')).toBeUndefined();
  });
});
