import { describe, it, expect } from 'vitest';
import { DispatchAdvisor } from './index';
import type { AgentProfile } from './matcher';
import type { CapabilityProfile } from '@/types/capabilityProfile';
import type { PhaseProposal } from '@/lib/breakdownParser';

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

describe('DispatchAdvisor', () => {
  it('enriches task proposals with suggested agentId', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'], skills: ['react'] }),
       makeAgent('toad', { domains: ['backend'], skills: ['sql'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: '实现 React 组件', description: '前端页面开发' },
          { title: '设计数据库 schema', description: 'SQL 建表' },
        ],
      },
    ];

    const result = advisor.suggest(phases, {});
    expect(result[0].tasks[0].agentId).toBe('luigi');
    expect(result[0].tasks[1].agentId).toBe('toad');
  });

  it('preserves existing agentId if already set', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: 'Some task', description: '', agentId: 'toad' },
        ],
      },
    ];

    const result = advisor.suggest(phases, {});
    expect(result[0].tasks[0].agentId).toBe('toad');
  });

  it('generates suggestion report for planner prompt', () => {
    const advisor = new DispatchAdvisor(
      [makeAgent('luigi', { domains: ['frontend'], skills: ['react'] }),
       makeAgent('toad', { domains: ['backend'], skills: ['sql'] })],
    );

    const phases: PhaseProposal[] = [
      {
        title: 'Phase 1',
        description: '',
        tasks: [
          { title: '实现 React 页面', description: '' },
        ],
      },
    ];

    const report = advisor.suggestReport(phases, {});
    expect(report).toContain('luigi');
    expect(report).toContain('实现 React 页面');
  });
});
