import { describe, expect, it } from 'vitest';
import { scanPassIntents } from '@/server/a2a/pass-intent';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

const AGENTS: AgentMentionConfig[] = [
  { id: 'dk', mentionPatterns: ['@dk'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
  { id: 'toad', mentionPatterns: ['@toad'] },
];

describe('scanPassIntents', () => {
  it('requires actionable intent before waking an agent', () => {
    expect(scanPassIntents('等 @dk 后面看看', AGENTS, 'mario')).toHaveLength(0);
    expect(scanPassIntents('这和 @luigi 上次说的一样', AGENTS, 'mario')).toHaveLength(0);
    expect(scanPassIntents('已分配给 @luigi，当前正在运行中', AGENTS, 'mario')).toHaveLength(0);
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

  it('detects natural implementation requests after a mention', () => {
    expect(scanPassIntents('@luigi 请根据以上架构设计开始实现前端组件', AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'implement' },
    ]);
    expect(scanPassIntents('@luigi 开始实现吧，这是一个需要多个组件协作完成的前端任务', AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'implement' },
    ]);
  });

  it('uses a later actionable mention when the first mention is contextual only', () => {
    const result = scanPassIntents('我参考了 @luigi 的旧方案。\n@luigi 请实现新的任务图加载兜底逻辑', AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ agentId: 'luigi', intent: 'implement' });
    expect(result[0].content).toContain('请实现新的任务图');
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

  it('detects task start and execution verbs as actionable handoffs', () => {
    expect(scanPassIntents('下一步：@toad 请立即启动 TASK-008（Execution Adapter），按看板交付测试。', AGENTS, 'mario')).toMatchObject([
      { agentId: 'toad', intent: 'delegate' },
    ]);
    expect(scanPassIntents('@toad 请执行 TASK-011，补齐 A2A 动作词覆盖。', AGENTS, 'mario')).toMatchObject([
      { agentId: 'toad', intent: 'delegate' },
    ]);
    expect(scanPassIntents('@toad 请认领并推进 TASK-011，完成后更新 TASKS.md。', AGENTS, 'mario')).toMatchObject([
      { agentId: 'toad', intent: 'delegate' },
    ]);
  });

  it('detects common English implementation verbs', () => {
    expect(scanPassIntents('@luigi please fix TASK-009 routing regression', AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'implement' },
    ]);
    expect(scanPassIntents('@luigi please update the task graph fallback view', AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'implement' },
    ]);
  });
});
