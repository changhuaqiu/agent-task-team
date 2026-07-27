import { describe, expect, it } from 'vitest';
import { buildCollaborationLayer } from './collaborationLayer';

describe('buildCollaborationLayer', () => {
  it('requires structured handoff outcomes and treats mentions as visible text only', () => {
    const result = buildCollaborationLayer();

    expect(result).toContain('agent_submit_outcome');
    expect(result).toContain('handoff_to_agent');
    expect(result).toContain('"branches"');
    expect(result).toContain('"toAgentId"');
    expect(result).toContain('"requestedAction"');
    expect(result).toContain('"evidenceRefs"');
    expect(result).toContain('@mention');
    expect(result).toContain('不会唤醒对方');
    expect(result).not.toContain('@agent 请/需要 + 动作 + 具体对象/交付物');
    expect(result).not.toContain('平台扫描');
  });
});
