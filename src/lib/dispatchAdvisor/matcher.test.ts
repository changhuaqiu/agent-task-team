import { describe, it, expect } from 'vitest';
import { matchTaskToAgent } from './matcher';
import type { AgentProfile } from './matcher';
import type { CapabilityProfile } from '@/types/capabilityProfile';

const makeAgent = (id: string, caps: Partial<CapabilityProfile>, forbidden: string[] = []): AgentProfile => ({
  id,
  forbiddenActions: forbidden,
  capabilities: {
    domains: [],
    skills: [],
    seniority: 'mid',
    maxConcurrentTasks: 1,
    ...caps,
  },
});

describe('matchTaskToAgent', () => {
  it('matches frontend task to frontend agent', () => {
    const frontend = makeAgent('luigi', { domains: ['frontend'], skills: ['react', 'typescript'] });
    const backend = makeAgent('toad', { domains: ['backend'], skills: ['node', 'sql'] });

    const result = matchTaskToAgent(
      { title: '实现登录页面的 React 组件', description: '使用 Tailwind CSS 构建登录表单' },
      [frontend, backend],
      {},
    );

    expect(result[0].agentId).toBe('luigi');
    expect(result[0].score).toBeGreaterThan(0);
  });

  it('matches backend task to backend agent', () => {
    const frontend = makeAgent('luigi', { domains: ['frontend'], skills: ['react'] });
    const backend = makeAgent('toad', { domains: ['backend'], skills: ['node', 'sql'] });

    const result = matchTaskToAgent(
      { title: '实现用户 API 接口', description: '设计 RESTful API 并编写数据库查询' },
      [frontend, backend],
      {},
    );

    expect(result[0].agentId).toBe('toad');
  });

  it('zero-scores agent whose maxConcurrentTasks is reached', () => {
    const luigi = makeAgent('luigi', { domains: ['frontend'], maxConcurrentTasks: 1 });

    const result = matchTaskToAgent(
      { title: '实现前端页面', description: '' },
      [luigi],
      { luigi: 1 },
    );

    expect(result[0].score).toBe(0);
  });

  it('zero-scores agent with matching forbidden action', () => {
    const reviewer = makeAgent('peach', { domains: ['review'] }, ['直接修改代码']);

    const result = matchTaskToAgent(
      { title: '修改代码实现功能', description: '需要直接修改源代码' },
      [reviewer],
      {},
    );

    expect(result[0].score).toBe(0);
  });

  it('ranks by combined domain + skill score', () => {
    const weak = makeAgent('weak', { domains: ['frontend'], skills: ['css'] });
    const strong = makeAgent('strong', { domains: ['frontend'], skills: ['react', 'typescript', 'tailwind'] });

    const result = matchTaskToAgent(
      { title: '使用 React 和 Tailwind 开发组件', description: 'typescript 组件' },
      [weak, strong],
      {},
    );

    expect(result[0].agentId).toBe('strong');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('returns all agents ranked by score descending', () => {
    const a = makeAgent('a', { domains: ['backend'], skills: ['sql'] });
    const b = makeAgent('b', { domains: ['frontend'], skills: ['react'] });
    const c = makeAgent('c', { domains: ['backend', 'frontend'], skills: ['react', 'sql'] });

    const result = matchTaskToAgent(
      { title: '数据库查询和前端展示', description: 'sql react' },
      [a, b, c],
      {},
    );

    expect(result).toHaveLength(3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('provides reason string explaining the match', () => {
    const agent = makeAgent('luigi', { domains: ['frontend'], skills: ['react'] });

    const result = matchTaskToAgent(
      { title: '开发 React 组件', description: '' },
      [agent],
      {},
    );

    expect(result[0].reason).toContain('frontend');
  });

  it('handles agent without capabilities gracefully', () => {
    const agent: AgentProfile = { id: 'unknown', forbiddenActions: [] };

    const result = matchTaskToAgent(
      { title: '做点什么', description: '' },
      [agent],
      {},
    );

    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('unknown');
  });
});
