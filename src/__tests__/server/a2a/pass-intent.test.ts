import { describe, expect, it } from 'vitest';
import { scanPassIntents } from '@/server/a2a/pass-intent';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario'] },
  { id: 'dk', mentionPatterns: ['@dk'] },
  { id: 'luigi', mentionPatterns: ['@luigi'] },
  { id: 'toad', mentionPatterns: ['@toad'] },
  { id: 'yoshi', mentionPatterns: ['@yoshi'] },
  { id: 'peach', mentionPatterns: ['@peach'] },
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

  it('does not turn status summaries into handoffs without a local action clause', () => {
    const result = scanPassIntents([
      '两个 agent 重新派发完毕：',
      '任务 Agent 状态',
      'TASK-001+002 @luigi bg_59d463d0 运行中',
      'TASK-004+005 @dk bg_b806e569 运行中',
    ].join('\n'), AGENTS, 'mario');

    expect(result).toEqual([]);
  });

  it('keeps an actionable worker handoff when a later clause forbids manual reviewer handoff', () => {
    const response = '@luigi 请启动 HOT-001：读取 package.json 并写 implementation.md，完成后置 review 并立即结束本轮——不要手工 @ 任何 reviewer，复核唤醒由平台自动处理。';

    expect(scanPassIntents(response, AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'implement', content: expect.stringContaining('请启动 HOT-001') },
    ]);
  });

  it('treats coordinator closure verbs as actionable handoffs', () => {
    expect(scanPassIntents('@mario 请汇总这条 dev 原文并给出一句结论', AGENTS, 'luigi')).toMatchObject([
      { agentId: 'mario', intent: 'delegate' },
    ]);
  });

  it('ignores contextual task roster mentions and keeps the later explicit handoff', () => {
    const response = [
      '看板已立，依赖链一目了然：',
      '- **TASK-001** @luigi（devops）— 读 package.json scripts',
      '- **TASK-002** @peach（testing）— 独立复核，依赖 TASK-001',
      '管道接好了，只开第一个阀门——Peach 的环节等上游水到再开。第一棒交出：',
      '@luigi 请启动 TASK-001：读取 package.json 的 scripts 字段。',
    ].join('\n');

    expect(scanPassIntents(response, AGENTS, 'mario')).toMatchObject([
      { agentId: 'luigi', intent: 'delegate', content: expect.stringContaining('请启动 TASK-001') },
    ]);
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

  it('detects Harness reject, escalation, coordination, and test handoff intents', () => {
    expect(scanPassIntents('@luigi 评审不通过，请修正按钮状态回归问题', AGENTS, 'peach')).toMatchObject([
      { agentId: 'luigi', intent: 'reject' },
    ]);
    expect(scanPassIntents('@toad API 契约需要和前端对齐，请确认字段命名', AGENTS, 'luigi')).toMatchObject([
      { agentId: 'toad', intent: 'coord' },
    ]);
    expect(scanPassIntents('@dk 这里发现 schema 边界问题，请做架构评审', AGENTS, 'peach')).toMatchObject([
      { agentId: 'dk', intent: 'review' },
    ]);
    expect(scanPassIntents('@dk 这个需求范围不清，需要 Mario 决策后再继续', AGENTS, 'luigi')).toMatchObject([
      { agentId: 'dk', intent: 'escalate' },
    ]);
    expect(scanPassIntents('@yoshi review 通过，请交给测试验收', AGENTS, 'peach')).toMatchObject([
      { agentId: 'yoshi', intent: 'handoff_test' },
    ]);
  });

  it('recognizes handoff intent even when a completion is mentioned before the target agent', () => {
    const results = scanPassIntents(
      '已完成 TASK-004 后端接口，@luigi 请启动 TASK-007 集成接线。',
      [{ id: 'luigi', mentionPatterns: ['@luigi'] }],
      'toad',
    );

    expect(results).toHaveLength(1);
    expect(results[0].intent).toBe('delegate');
    expect(results[0].agentId).toBe('luigi');
  });

  it('blocks non-actionable completion mentions without handoff verbs', () => {
    const results = scanPassIntents(
      '已完成 TASK-004 后端接口，@luigi。',
      [{ id: 'luigi', mentionPatterns: ['@luigi'] }],
      'toad',
    );

    expect(results).toHaveLength(0);
  });
});
