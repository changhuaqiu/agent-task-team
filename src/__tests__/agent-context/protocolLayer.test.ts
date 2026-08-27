import { describe, it, expect } from 'vitest';
import { buildProtocolLayer } from '@/lib/agent-context/layers/protocolLayer';

describe('buildProtocolLayer', () => {
  it('includes identity while treating the Task projection as read-only', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: false });
    expect(result).toContain('agentId: luigi');
    expect(result).toContain('Role: backend');
    expect(result).toContain('Task/TASKS.md 是只读投影');
    expect(result).toContain('不要自行修改 Task Graph');
  });

  it('requires one structured outcome when a task is assigned', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: true });
    expect(result).toContain('你已被分配任务');
    expect(result).toContain('提交一个结构化 outcome');
  });

  it('does not duplicate planner dispatch responsibilities', () => {
    const result = buildProtocolLayer({ agentId: 'mario', agentRole: 'planner', hasTaskAssignment: false });
    expect(result).not.toContain('调度职责');
  });

  it('does not invent Task Graph work when no task is assigned', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: false });
    expect(result).toContain('不要把模糊请求自行升级为实现');
  });

  it('keeps reviewer decisions behind a structured outcome', () => {
    const result = buildProtocolLayer({ agentId: 'peach', agentRole: 'testing', hasTaskAssignment: true });
    expect(result).toContain('不跳过 review 或伪造执行/验收证据');
    expect(result).toContain('结构化生命周期工具');
  });
});
