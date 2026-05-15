import { describe, expect, it } from 'vitest';
import { scanPassIntents } from '@/server/a2a/pass-intent';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

const AGENTS: AgentMentionConfig[] = [
  { id: 'dk', mentionPatterns: ['@dk'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
];

describe('scanPassIntents', () => {
  it('requires actionable intent before waking an agent', () => {
    expect(scanPassIntents('等 @dk 后面看看', AGENTS, 'mario')).toHaveLength(0);
    expect(scanPassIntents('这和 @luigi 上次说的一样', AGENTS, 'mario')).toHaveLength(0);
  });

  it('extracts explicit pass intent and target content', () => {
    const result = scanPassIntents('@dk 请审查 WT-0 架构方案和风险项', AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agentId: 'dk',
      intent: 'review',
    });
    expect(result[0].content).toContain('请审查 WT-0');
  });

  it('supports inline handoff language', () => {
    const result = scanPassIntents('这个任务交给 @luigi 实现 UI 组件', AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
    expect(result[0].intent).toBe('implement');
  });

  it('treats dispatch summaries as actionable handoffs', () => {
    const result = scanPassIntents([
      '两个 agent 重新派发完毕：',
      '任务 Agent 状态',
      'TASK-001+002 @luigi bg_59d463d0 运行中',
      'TASK-004+005 @dk bg_b806e569 运行中',
    ].join('\n'), AGENTS, 'mario');

    expect(result.map((target) => target.agentId)).toEqual(['luigi', 'dk']);
    expect(result.every((target) => target.intent === 'delegate')).toBe(true);
    expect(result[0].content).toContain('重新派发完毕');
  });
});
