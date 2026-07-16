import { describe, it, expect } from 'vitest';
import { buildProtocolLayer, deriveRoleFromCard } from '@/lib/agent-context/layers/protocolLayer';

describe('deriveRoleFromCard', () => {
  it('returns first domain from capabilities', () => {
    const roleCard = { capabilities: { domains: ['backend', 'api'] } } as any;
    expect(deriveRoleFromCard(roleCard)).toBe('backend');
  });

  it('returns "worker" when no capabilities', () => {
    expect(deriveRoleFromCard(undefined)).toBe('worker');
  });
});

describe('buildProtocolLayer', () => {
  it('includes constraints section with agentId and role', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: false, isPlanner: false });
    expect(result).toContain('agentId: luigi');
    expect(result).toContain('Role: backend');
    expect(result).toContain('.ath/TASKS.md');
    expect(result).toContain('.ath/PROTOCOLS.md');
  });

  it('includes task assignment guidance when hasTaskAssignment=true', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: true, isPlanner: false });
    expect(result).toContain('你被分配了');
  });

  it('includes planner guidance when isPlanner=true', () => {
    const result = buildProtocolLayer({ agentId: 'mario', agentRole: 'planner', projectPath: '/project', hasTaskAssignment: false, isPlanner: true });
    expect(result).toContain('调度职责');
  });

  it('includes self-check guidance when no task and not planner', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', projectPath: '/project', hasTaskAssignment: false, isPlanner: false });
    expect(result).toContain('自检');
  });

  it('allows a reviewer to make only the assigned gate decision', () => {
    const result = buildProtocolLayer({ agentId: 'peach', agentRole: 'testing', projectPath: '/project', hasTaskAssignment: true, isPlanner: false });
    expect(result).toContain('PASS → done');
    expect(result).toContain('唯一例外是 reviewer');
  });
});
