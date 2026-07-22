import { describe, expect, it } from 'vitest';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { TeamRuntime, RuntimeAgent, RuntimeAgentProfile, PresetRuntimeAgentInput } from '@/lib/team-runtime';
import type { RoleCard } from '@/types/roleCard';
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

const presetAgent: PresetRuntimeAgentInput = {
  id: 'mario',
  name: 'Mario',
  roleCardId: 'rc-planner',
  theme: 'mario',
  emoji: '⭐',
  accountIds: ['acc-agent'],
};

function roleCard(id: string, displayName: string): RoleCard {
  return {
    id,
    name: id,
    displayName,
    description: `${displayName} role card`,
    category: 'planner',
    tags: [],
    applicableScenarios: [],
    responsibilities: [],
    nonResponsibilities: [],
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'structured',
    preferStructuredOutput: true,
    allowedActions: [],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: [],
    outputFormat: 'structured_list',
    requiresEvidence: false,
    riskGrading: 'none',
    isPreset: false,
    version: 1,
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

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

  it('inherits a global Agent account when the matching TeamPack role has no explicit binding', () => {
    const inheritedPack: TeamPack = {
      ...teamPack,
      roles: [{ id: 'mario', displayName: 'Mario Planner', soul: '', required: true }],
    };
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team-inherit',
      teamPack: inheritedPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['mario'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster[0]).toMatchObject({ id: 'mario', accountIds: ['acc-agent'] });
  });

  it('does not resurrect stale Role Card accounts over an authoritative empty Agent binding', () => {
    const staleCard = { ...roleCard('rc-planner', 'Planner'), accountIds: ['stale-account'] };
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-stale-role-account',
      presetAgents: [{ ...presetAgent, accountIds: [] }],
      activeAgentIds: ['mario'],
      roleCards: [staleCard],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: { mario: [] },
      agentRoleCardOverrides: {},
    });

    expect(runtime.roster[0]).toMatchObject({ id: 'mario', accountIds: [] });
  });

  it('lets TeamPack role card overrides replace default role cards', () => {
    const defaultCard = roleCard('rc-default', 'Default Planner');
    const overrideCard = roleCard('rc-override', 'Override Planner');
    const teamPackWithDefaultRoleCard: TeamPack = {
      ...teamPack,
      roles: teamPack.roles.map((role) =>
        role.id === 'planner' ? { ...role, roleCardId: defaultCard.id } : role,
      ),
    };

    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team-override',
      teamPack: teamPackWithDefaultRoleCard,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [defaultCard, overrideCard],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: { planner: overrideCard.id },
    });

    expect(runtime.roster[0]).toMatchObject({
      id: 'planner',
      roleCardId: overrideCard.id,
      displayName: overrideCard.displayName,
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

  it('does not resurrect removed roles from older default-team matrices', () => {
    const oldDefaultTeam: TeamPack = {
      ...teamPack,
      id: 'default-team-old',
      name: 'default-team',
      displayName: 'Mario 6人组',
      roles: ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'].map((id) => ({
        id,
        displayName: id,
        soul: '',
        required: true,
      })),
      communicationMatrix: {
        mario: { canSendTo: ['luigi', 'toad', 'peach'], canReceiveFrom: ['luigi', 'toad', 'peach'] },
        luigi: { canSendTo: ['mario', 'peach'], canReceiveFrom: ['mario', 'peach'] },
        toad: { canSendTo: ['mario', 'luigi', 'peach'], canReceiveFrom: ['mario', 'luigi', 'peach'] },
        peach: { canSendTo: ['mario', 'luigi', 'toad'], canReceiveFrom: ['mario', 'luigi', 'toad'] },
        dk: { canSendTo: ['mario'], canReceiveFrom: ['mario'] },
        yoshi: { canSendTo: ['mario'], canReceiveFrom: ['mario'] },
      },
    };

    const runtime = resolveTeamRuntime({
      conversationId: 'conv-default-old',
      teamPack: oldDefaultTeam,
      presetAgents: [],
      activeAgentIds: ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.communicationPolicy.canSend('peach', 'yoshi')).toBe(false);
    expect(runtime.communicationPolicy.canSend('yoshi', 'dk')).toBe(false);
    expect(runtime.communicationPolicy.getEscalationTarget?.('peach', 'yoshi')).toBe('mario');
  });
});

describe('resolveRuntimeAgentProfile', () => {
  it('resolves execution engine and account from the first enabled account', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      {
        id: 'acc-team',
        name: 'OpenAI',
        authMode: 'api_key',
        provider: 'openai',
        models: ['gpt-5.4'],
        enabled: true,
        status: 'valid',
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'codex', accountId: 'acc-team' },
      prompt: { teamPack: { id: 'pack-1' } },
    });
  });

  it('skips disabled accounts and uses the next enabled one', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [
        {
          id: 'planner',
          displayName: 'Planner',
          source: 'team-pack-role',
          accountIds: ['acc-disabled', 'acc-enabled'],
          skills: [],
        },
      ],
      communicationPolicy: {
        canSend: () => true,
        explainBlock: () => undefined,
      },
      workflowPolicy: {
        assignInitialTask: () => null,
        getNextAgent: () => null,
      },
    };

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      { id: 'acc-disabled', provider: 'openai', enabled: false },
      { id: 'acc-enabled', provider: 'anthropic', enabled: true },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'claude', accountId: 'acc-enabled' },
    });
  });

  it('falls back to explicit cliEngine when no account is enabled', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [
        {
          id: 'planner',
          displayName: 'Planner',
          source: 'team-pack-role',
          accountIds: ['acc-disabled'],
          cliEngine: 'gemini',
          skills: [],
        },
      ],
      communicationPolicy: {
        canSend: () => true,
        explainBlock: () => undefined,
      },
      workflowPolicy: {
        assignInitialTask: () => null,
        getNextAgent: () => null,
      },
    };

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      { id: 'acc-disabled', provider: 'openai', enabled: false },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'gemini' },
    });
    expect(profile?.execution.accountId).toBeUndefined();
  });

  it('returns null when there is no enabled account and no explicit cliEngine', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [
        {
          id: 'planner',
          displayName: 'Planner',
          source: 'team-pack-role',
          accountIds: ['acc-disabled'],
          skills: [],
        },
      ],
      communicationPolicy: {
        canSend: () => true,
        explainBlock: () => undefined,
      },
      workflowPolicy: {
        assignInitialTask: () => null,
        getNextAgent: () => null,
      },
    };

    expect(
      resolveRuntimeAgentProfile(runtime, 'planner', [
        { id: 'acc-disabled', provider: 'openai', enabled: false },
      ]),
    ).toBeNull();
  });

  it('returns null when the runtime agent does not exist', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-team',
      teamPack,
      presetAgents: [presetAgent],
      activeAgentIds: ['planner'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(resolveRuntimeAgentProfile(runtime, 'ghost', [])).toBeNull();
  });
});
