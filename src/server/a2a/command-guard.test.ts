import { describe, expect, it, vi } from 'vitest';
import type { TeamRuntime } from '@/lib/team-runtime';
import { A2ACommandGuard } from './command-guard';

function runtime(explainHandoffBlock: (from: string, to: string) => string | undefined): TeamRuntime {
  return {
    conversationId: 'project-policy',
    roster: [
      { id: 'lead', displayName: 'Lead', source: 'preset-agent', accountIds: [], skills: [] },
      { id: 'builder', displayName: 'Builder', source: 'preset-agent', accountIds: [], skills: [] },
    ],
    explainHandoffBlock,
    initialAgentId: null,
  };
}

describe('A2ACommandGuard', () => {
  it('accepts an agent handoff only when source, target and policy all allow it', () => {
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(() => undefined),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).not.toThrow();
  });

  it('rejects targets outside the conversation roster', () => {
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(() => undefined),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'global-only-agent' }],
    })).toThrowError(expect.objectContaining({
      reasonCode: 'a2a_target_not_in_roster',
    }));
  });

  it('enforces communication policy for agents but not explicit human commands', () => {
    const explainHandoffBlock = vi.fn(() => 'review must go through lead');
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(explainHandoffBlock),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).toThrowError('a2a_communication_policy_blocked: lead:builder:review must go through lead');
    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'human',
      fromHolderType: 'user',
      branches: [{ toAgentId: 'builder' }],
    })).not.toThrow();
    expect(explainHandoffBlock).toHaveBeenCalledTimes(1);
  });

  it('treats an empty policy reason as blocked and uses the generic detail', () => {
    const explainHandoffBlock = vi.fn(() => '');
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(explainHandoffBlock),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).toThrowError('a2a_communication_policy_blocked: lead:builder:communication policy denied the handoff');
    expect(explainHandoffBlock).toHaveBeenCalledTimes(1);
  });

  it('rejects an agent source outside the roster before consulting policy', () => {
    const explainHandoffBlock = vi.fn(() => undefined);
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(explainHandoffBlock),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'outside-agent',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).toThrowError(expect.objectContaining({
      reasonCode: 'a2a_source_not_in_roster',
    }));
    expect(explainHandoffBlock).not.toHaveBeenCalled();
  });

  it('rejects a missing conversation runtime before the aggregate is called', () => {
    const guard = new A2ACommandGuard({
      resolveRuntime: () => undefined,
    });

    expect(() => guard.assert({
      conversationId: 'missing',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).toThrowError(expect.objectContaining({
      reasonCode: 'a2a_conversation_runtime_missing',
    }));
  });
});
