import { describe, expect, it } from 'vitest';
import type { RoleCard } from '@/types/roleCard';
import { buildTeamLayer } from './teamLayer';

function makeRoleCard(overrides: Partial<RoleCard> = {}): RoleCard {
  return {
    id: 'test-role',
    name: 'Test Role',
    displayName: '测试角色',
    description: 'A test role card',
    category: 'planner',
    tags: [],
    applicableScenarios: [],
    responsibilities: [],
    nonResponsibilities: [],
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'concise',
    preferStructuredOutput: false,
    allowedActions: [],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: [],
    outputFormat: 'freeform',
    requiresEvidence: false,
    riskGrading: 'none',
    isPreset: false,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildTeamLayer', () => {
  it('returns a roster and collaboration rules', () => {
    const result = buildTeamLayer('mario', []);
    expect(result).not.toBe('');
    expect(result).toContain('@luigi');
    expect(result).toContain('协作规则');
  });

  it('excludes self and requires structured collaboration handoffs', () => {
    const roleCard = makeRoleCard({
      id: 'preset-frontend',
      displayName: '前端工程师',
      category: 'frontend',
      responsibilities: ['组件开发', '样式实现', '页面交互'],
    });
    const result = buildTeamLayer('mario', [roleCard]);

    expect(result).not.toContain('@mario');
    expect(result).toContain('@luigi');
    expect(result).toContain('实现');
    expect(result).toContain('协作规则');
    expect(result).toContain('agent_submit_outcome');
    expect(result).toContain('handoff_to_agent');
    expect(result).toContain('不会唤醒执行');
    expect(result).not.toContain('@agent 请/需要 + 动作 + 具体对象/交付物');
    expect(result).not.toContain('另起一行行首写 @agentId');
  });

  it('uses a fallback role label without a matching role card', () => {
    expect(buildTeamLayer('mario', [])).not.toBe('');
  });
});
