import { describe, expect, it, vi } from 'vitest';
import type { TeamRuntime } from '@/lib/team-runtime';
import { A2ACommandGuard } from './command-guard';

function runtime(explainBlock: (from: string, to: string) => string | undefined): TeamRuntime {
  return {
    conversationId: 'project-policy',
    roster: [
      { id: 'lead', displayName: 'Lead', source: 'preset-agent', accountIds: [], skills: [] },
      { id: 'builder', displayName: 'Builder', source: 'preset-agent', accountIds: [], skills: [] },
    ],
    communicationPolicy: {
      explainBlock,
    },
    workflowPolicy: {
      selectInitialAgent: () => null,
    },
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
    const explainBlock = vi.fn(() => 'review must go through lead');
    const guard = new A2ACommandGuard({
      resolveRuntime: () => runtime(explainBlock),
    });

    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'lead',
      fromHolderType: 'agent',
      branches: [{ toAgentId: 'builder' }],
    })).toThrowError(expect.objectContaining({
      reasonCode: 'a2a_communication_policy_blocked',
    }));
    expect(() => guard.assert({
      conversationId: 'project-policy',
      fromHolderId: 'human',
      fromHolderType: 'user',
      branches: [{ toAgentId: 'builder' }],
    })).not.toThrow();
    expect(explainBlock).toHaveBeenCalledTimes(1);
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
