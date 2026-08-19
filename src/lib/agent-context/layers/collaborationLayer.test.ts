import { describe, expect, it } from 'vitest';
import { buildCollaborationLayer } from './collaborationLayer';

describe('buildCollaborationLayer', () => {
  it('requires structured handoff outcomes and treats mentions as visible text only', () => {
    const result = buildCollaborationLayer();

    expect(result).toContain('agent_submit_outcome');
    expect(result).toContain('handoff_to_agent');
    expect(result).toContain('branches');
    expect(result).toContain('toAgentId');
    expect(result).toContain('requestedAction');
    expect(result).toContain('evidenceRefs');
    expect(result).toContain('本轮退出决策');
    expect(result).toContain('continue_work');
    expect(result).toContain('精确下一动作');
    expect(result).toContain('外部依赖、人类决策或权限边界');
    expect(result).toContain('伪协作结果');
    expect(result).toContain('@mention');
    expect(result).toContain('不会唤醒对方');
    expect(result).toContain('不要用流程辩解代替行动');
    expect(result).toContain('对用户说人话');
    expect(result).toContain('话多、绕、没在做事、怎么还没结束');
    expect(result).toContain('TASKS.md');
    expect(result).toContain('只读权威事实');
    expect(result).toContain('只调用一次');
    expect(result).not.toContain('@agent 请/需要 + 动作 + 具体对象/交付物');
    expect(result).not.toContain('平台扫描');
  });
});
