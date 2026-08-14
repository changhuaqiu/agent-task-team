import { describe, expect, it } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { AGENT_ROSTER } from '@/store/agentStore';

describe('default team Harness role classification', () => {
  it('classifies DK as reviewer instead of implementer', () => {
    const dk = AGENT_ROSTER.find((agent) => agent.id === 'dk');
    const roleCard = PRESET_ROLE_CARDS.find((card) => card.id === dk?.roleCardId);

    expect(dk?.roleCardId).toBe('preset-arch-reviewer');
    expect(roleCard?.category).toBe('arch_reviewer');
  });
});
