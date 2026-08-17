import { describe, expect, it } from 'vitest';
import { buildProtocolLayer } from './protocolLayer';

describe('buildProtocolLayer', () => {
  it('treats task state as read-only and asks for one structured outcome', () => {
    const result = buildProtocolLayer({
      agentId: 'peach',
      agentRole: 'reviewer',
      hasTaskAssignment: true,
    });

    expect(result).toContain('Task/TASKS.md 是只读投影');
    expect(result).toContain('agent_submit_outcome');
    expect(result).toContain('提交一个结构化 outcome');
    expect(result).toContain('工具调用由平台单独显示');
    expect(result).toContain('正文不复述工具流水');
  });
});
