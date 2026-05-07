import { describe, expect, it } from 'vitest';
import type { TeamRuntime, RuntimeAgent, RuntimeAgentProfile } from '@/lib/team-runtime';

describe('team-runtime public contract', () => {
  it('exports runtime contract types through the public index', () => {
    const agent: RuntimeAgent = {
      id: 'planner',
      displayName: 'Planner',
      source: 'team-pack-role',
      accountIds: [],
      skills: [],
    };

    const runtime: TeamRuntime = {
      conversationId: 'conv-1',
      roster: [agent],
      communicationPolicy: {
        canSend: () => true,
        explainBlock: () => undefined,
      },
      workflowPolicy: {
        assignInitialTask: () => null,
        getNextAgent: () => null,
      },
    };

    const profile: RuntimeAgentProfile = {
      agent,
      execution: { engine: 'opencode' },
      prompt: { skills: [], roster: runtime.roster },
    };

    expect(profile.agent.id).toBe('planner');
    expect(runtime.roster).toHaveLength(1);
  });
});
