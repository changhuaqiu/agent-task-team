import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '@/store/agentStore';

describe('default team Agent Definition permissions', () => {
  it('defines DK as a reviewer instead of an implementer', () => {
    const dk = AGENT_ROSTER.find((agent) => agent.id === 'dk');

    expect(dk?.canReview).toBe(true);
    expect(dk?.canModifyCode).toBe(false);
    expect(dk?.instructions).toContain('架构');
  });
});
