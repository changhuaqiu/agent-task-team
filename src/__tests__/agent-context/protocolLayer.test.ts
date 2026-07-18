import { describe, it, expect } from 'vitest';
import { buildProtocolLayer, deriveRoleFromCard } from '@/lib/agent-context/layers/protocolLayer';
import type { RoleCard } from '@/types/roleCard';

describe('deriveRoleFromCard', () => {
  it('returns first domain from capabilities', () => {
    const roleCard = { capabilities: { domains: ['backend', 'api'] } } as unknown as RoleCard;
    expect(deriveRoleFromCard(roleCard)).toBe('backend');
  });

  it('returns "worker" when no capabilities', () => {
    expect(deriveRoleFromCard(undefined)).toBe('worker');
  });
});

describe('buildProtocolLayer', () => {
  it('includes identity and requires the runtime absolute task path', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: false });
    expect(result).toContain('agentId: luigi');
    expect(result).toContain('Role: backend');
    expect(result).toContain('任务看板绝对路径');
    expect(result).not.toContain('.ath/TASKS.md');
  });

  it('includes task assignment guidance when hasTaskAssignment=true', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: true });
    expect(result).toContain('你被分配了');
  });

  it('does not duplicate planner dispatch responsibilities', () => {
    const result = buildProtocolLayer({ agentId: 'mario', agentRole: 'planner', hasTaskAssignment: false });
    expect(result).not.toContain('调度职责');
  });

  it('includes self-check guidance when no task', () => {
    const result = buildProtocolLayer({ agentId: 'luigi', agentRole: 'backend', hasTaskAssignment: false });
    expect(result).toContain('自检');
  });

  it('allows a reviewer to make only the assigned gate decision', () => {
    const result = buildProtocolLayer({ agentId: 'peach', agentRole: 'testing', hasTaskAssignment: true });
    expect(result).toContain('PASS → done');
    expect(result).toContain('唯一例外是 reviewer');
  });
});
