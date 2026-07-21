import { describe, expect, it } from 'vitest';
import { PRESET_ROLE_CARD_MAP } from '@/data/presetRoleCards';
import type { RoleCard } from '@/types/roleCard';
import { buildRoleLayer } from './roleLayer';

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

const agent = { id: 'mario', name: 'Mario' };

describe('buildRoleLayer', () => {
  it('returns empty string when no roleCard is provided', () => {
    expect(buildRoleLayer(agent)).toBe('');
    expect(buildRoleLayer(agent, undefined)).toBe('');
  });

  it('includes the persona introduction', () => {
    const roleCard = makeRoleCard({
      persona: { introduction: '我是规划专家', voice: '', mindset: '', habits: '', collaboration: '' },
    });

    expect(buildRoleLayer(agent, roleCard)).toContain('我是规划专家');
  });

  it('includes non-empty persona dimensions', () => {
    const roleCard = makeRoleCard({
      persona: {
        introduction: 'intro',
        voice: '友好语气',
        mindset: '结构化思维',
        habits: '先分析后执行',
        collaboration: '主动沟通',
      },
    });
    const result = buildRoleLayer(agent, roleCard);

    expect(result).toContain('## 语气风格');
    expect(result).toContain('友好语气');
    expect(result).toContain('## 思维模式');
    expect(result).toContain('结构化思维');
    expect(result).toContain('## 工作习惯');
    expect(result).toContain('先分析后执行');
    expect(result).toContain('## 协作风格');
    expect(result).toContain('主动沟通');
  });

  it('omits empty persona dimensions', () => {
    const roleCard = makeRoleCard({
      persona: { introduction: 'intro', voice: 'voice', mindset: '', habits: '', collaboration: '' },
    });
    const result = buildRoleLayer(agent, roleCard);

    expect(result).toContain('## 语气风格');
    expect(result).not.toContain('## 思维模式');
    expect(result).not.toContain('## 工作习惯');
    expect(result).not.toContain('## 协作风格');
  });

  it('includes responsibility constraints', () => {
    const roleCard = makeRoleCard({
      responsibilities: ['任务分解', '资源协调'],
      nonResponsibilities: ['直接编码'],
      forbiddenActions: ['修改数据库'],
    });
    const result = buildRoleLayer(agent, roleCard);

    expect(result).toContain('## 角色约束');
    expect(result).toContain('- 职责：任务分解、资源协调');
    expect(result).toContain('- 非职责：直接编码');
    expect(result).toContain('- 禁止：修改数据库');
  });

  it('includes the evidence constraint', () => {
    const result = buildRoleLayer(agent, makeRoleCard({ requiresEvidence: true }));
    expect(result).toContain('- 评审/建议必须附带具体证据和文件引用');
  });

  it('includes a non-freeform output format', () => {
    const result = buildRoleLayer(agent, makeRoleCard({ outputFormat: 'structured_list' }));
    expect(result).toContain('- 输出格式：结构化列表');
  });

  it('omits the freeform output format', () => {
    const result = buildRoleLayer(agent, makeRoleCard({ outputFormat: 'freeform', category: 'frontend' }));
    expect(result).not.toContain('输出格式');
  });

  it('includes the propose-only constraint', () => {
    const result = buildRoleLayer(agent, makeRoleCard({ allowedActions: ['can_propose_only'] }));
    expect(result).toContain('- 只能提出建议，不能直接修改代码');
  });

  it('omits propose-only when code modification is also allowed', () => {
    const roleCard = makeRoleCard({ allowedActions: ['can_propose_only', 'can_modify_code'] });
    expect(buildRoleLayer(agent, roleCard)).not.toContain('只能提出建议');
  });

  it('does not make the implementation role advisory-only', () => {
    const result = buildRoleLayer(
      { id: 'luigi', name: 'Luigi' },
      PRESET_ROLE_CARD_MAP['preset-frontend'],
    );

    expect(result).toContain('## 角色约束');
    expect(result).toContain('职责：全栈开发、API 设计、数据模型、UI 组件、接口契约');
    expect(result).not.toContain('只能提出建议，不能直接修改代码');
  });

  it('keeps the planner persona voice internally consistent', () => {
    const result = buildRoleLayer(
      { id: 'mario', name: 'Mario' },
      PRESET_ROLE_CARD_MAP['preset-planner'],
    );

    expect(result).toContain('沉稳');
    expect(result).not.toContain('走！');
  });

  it('includes confirmation constraints', () => {
    const roleCard = makeRoleCard({ requiresConfirmation: ['架构变更', '数据库迁移'] });
    expect(buildRoleLayer(agent, roleCard)).toContain('- 以下操作需用户确认：架构变更、数据库迁移');
  });

  it('omits the constraints section when none apply', () => {
    expect(buildRoleLayer(agent, makeRoleCard())).not.toContain('## 角色约束');
  });
});
