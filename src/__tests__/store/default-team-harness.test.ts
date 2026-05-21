import { describe, expect, it } from 'vitest';
import { AGENT_ROSTER } from '@/store/agentStore';

describe('default team Harness role classification', () => {
  it('classifies DK as reviewer instead of implementer', () => {
    const dk = AGENT_ROSTER.find((agent) => agent.id === 'dk');

    expect(dk?.roleCardId).toBe('preset-arch-reviewer');
    expect(dk?.role).toBe('reviewer');
  });
});
