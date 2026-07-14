import { describe, it, expect } from 'vitest';
import { filterVisible } from './contextRecord';
import type { ContextRecord, VisibilityCtx } from './contextRecord';

const shared = (overrides: Partial<ContextRecord> = {}): ContextRecord => ({
  content: 'x',
  scope: '/project',
  private: false,
  importance: 0.5,
  category: 'decision',
  ...overrides,
});

describe('filterVisible — §9 recall 规则', () => {
  const luigi: VisibilityCtx = { agentId: 'luigi', allowedScopes: ['/project', '/project/luigi'] };
  const mario: VisibilityCtx = { agentId: 'mario', allowedScopes: ['/project', '/project/mario'] };

  it('共享记录（private=false, scope=/project）对所有允许 /project 的 agent 可见', () => {
    const records = [shared({ content: 'goal' })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
    expect(filterVisible(records, mario)).toHaveLength(1);
  });

  it('自己的私有轨迹（source=自己）可见', () => {
    const records = [shared({
      content: 'my trace', scope: '/project/luigi', private: true,
      source: 'luigi', category: 'trajectory', importance: 0.3,
    })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
  });

  it('别人的私有轨迹（source≠自己）不可见——即使 scope 前缀匹配', () => {
    const records = [shared({
      content: 'mario trace', scope: '/project/mario', private: true,
      source: 'mario', category: 'trajectory', importance: 0.3,
    })];
    // luigi 的 allowedScopes 含 /project，/project/mario 前缀匹配 → scopeOk，
    // 但 private=true 且 source=mario≠luigi → 过滤掉
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('scope 不在任何 allowedScope 前缀下 → 不可见', () => {
    const records = [shared({ content: 'x', scope: '/other-project' })];
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('scope 恰等于 allowedScope → 可见', () => {
    const records = [shared({ content: 'x', scope: '/project/luigi', private: false })];
    expect(filterVisible(records, luigi)).toHaveLength(1);
  });

  it('前缀匹配以路径段为单位（/project 不误匹配 /project-x）', () => {
    const records = [shared({ content: 'x', scope: '/project-x' })];
    expect(filterVisible(records, luigi)).toHaveLength(0);
  });

  it('空记录列表 → 空', () => {
    expect(filterVisible([], luigi)).toEqual([]);
  });
});
