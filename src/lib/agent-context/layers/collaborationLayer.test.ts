import { describe, expect, it } from 'vitest';
import { buildCollaborationLayer } from './collaborationLayer';

describe('buildCollaborationLayer', () => {
  it('distinguishes agent wakeups from awareness mentions', () => {
    const result = buildCollaborationLayer();

    expect(result).toContain('## Agent 协作协议');
    expect(result).toContain('系统会自动在群聊通知相关角色');
    expect(result).toContain('@agent 请/需要 + 动作 + 具体对象/交付物');
    expect(result).toContain('启动、执行、完成、认领、推进');
    expect(result).toContain('fix、update、implement、build、execute');
    expect(result).toContain('通知 @mario 查看结果');
    expect(result).toContain('不会唤醒对方');
  });
});
