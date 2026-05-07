import { describe, expect, it } from 'vitest';
import { resolveTeamRuntime } from '@/lib/team-runtime';
import type { TeamRuntime, RuntimeAgent, RuntimeAgentProfile } from '@/lib/team-runtime';
import type { Agent } from '@/store/agentStore';
import type { TeamPack } from '@/types/teamPack';

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

const presetAgent: Agent = {
  id: 'mario',
  name: 'Mario',
  role: 'planner',
  roleLabel: 'Planner',
  roleCardId: 'rc-planner',
  theme: 'mario',
  emoji: '⭐',
  isOnline: true,
  accountIds: ['acc-agent'],
};

const teamPack: TeamPack = {
  id: 'pack-1',
  specVersion: 'team-pack/0.1',
  name: 'engineering-trio',
  displayName: 'Engineering Trio',
  description: 'Planner coder reviewer',
  version: '1.0.0',
  tags: [],
  category: 'engineering',
  roles: [
    { id: 'planner', displayName: 'Planner', soul: '', required: true, accountIds: ['acc-team'] },
    { id: 'reviewer', displayName: 'Reviewer', soul: '', required: true },
  ],
  teamMode: 'pipeline',
  workflow: {
    type: 'linear',
    steps: [
      { role: 'planner', action: 'plan', output: 'plan' },
      { role: 'reviewer', action: 'review', output: 'review' },
    ],
  },
  communicationMatrix: {
    planner: { canSendTo: ['reviewer'], canReceiveFrom: [] },
    reviewer: { canSendTo: [], canReceiveFrom: ['planner'] },
  },
  isPreset: false,
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
};

describe('resolveTeamRuntime', () => {
  it('uses preset roster when no TeamPack is bound', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-plain',
      presetAgents: [presetAgent],
      activeAgentIds: ['mario'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster).toEqual([
      expect.objectContaining({
        id: 'mario',
        displayName: 'Mario',
        source: 'preset-agent',
      }),
    ]);
  });

  it('uses TeamPack roles as the primary runtime roster when a TeamPack is bound', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster.map((agent) => agent.id)).toEqual(['planner', 'reviewer']);
    expect(runtime.roster[0]).toMatchObject({
      id: 'planner',
      displayName: 'Planner',
      source: 'team-pack-role',
      accountIds: ['acc-team'],
    });
  });

  it('enforces communication matrix for TeamPack runtime', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.communicationPolicy.canSend('planner', 'reviewer')).toBe(true);
    expect(runtime.communicationPolicy.canSend('reviewer', 'planner')).toBe(false);
    expect(runtime.communicationPolicy.explainBlock('reviewer', 'planner')).toBe('团队协作规则阻止了这次转交');
  });
});
