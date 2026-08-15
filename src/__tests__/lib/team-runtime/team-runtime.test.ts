import { describe, expect, it } from 'vitest';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { TeamRuntime, RuntimeAgent, RuntimeAgentProfile, PresetRuntimeAgentInput } from '@/lib/team-runtime';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';
import { buildTeamPackLayer } from '@/lib/agent-context/layers/teamPackLayer';

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
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
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

const initialAssignmentCases = [
  {
    mode: 'pipeline',
    workflow: {
      type: 'linear',
      steps: [
        { role: 'reviewer', action: 'review', output: 'review' },
        { role: 'planner', action: 'plan', output: 'plan' },
      ],
    },
    expected: 'reviewer',
  },
  {
    mode: 'parallel',
    workflow: {
      type: 'linear',
      steps: [
        { role: 'missing-role', action: 'skip', output: 'none' },
        { role: 'planner', action: 'plan', output: 'plan' },
      ],
    },
    expected: 'planner',
  },
  {
    mode: 'hub_spoke',
    workflow: {
      type: 'state_machine',
      states: [
        { name: 'done', role: 'planner', description: 'Done', transitions: [], terminal: true },
        { name: 'review', role: 'reviewer', description: 'Review', transitions: [] },
      ],
    },
    expected: 'reviewer',
  },
  {
    mode: 'custom',
    workflow: {
      type: 'state_machine',
      states: [
        { name: 'plan', role: 'planner', description: 'Plan', transitions: [] },
        { name: 'review', role: 'reviewer', description: 'Review', transitions: [] },
      ],
    },
    expected: 'planner',
  },
] satisfies Array<{
  mode: TeamPack['teamMode'];
  workflow: TeamPack['workflow'];
  expected: string;
}>;

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
    expect(runtime.explainHandoffBlock('mario', 'any-agent')).toBeUndefined();
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

  it.each(initialAssignmentCases)(
    'selects the initial $mode workflow agent through the Team Runtime interface',
    ({ mode, workflow, expected }) => {
      const runtime = resolveTeamRuntime({
        conversationId: `conv-${mode}`,
        teamPack: { ...teamPack, teamMode: mode, workflow },
        presetAgents: [presetAgent],
        activeAgentIds: ['planner', 'reviewer'],
        roleCards: [],
        skillsMap: {},
        agentSkillIds: {},
        agentAccountOverrides: {},
        agentRoleCardOverrides: {},
      });

      expect(runtime.initialAgentId).toBe(expected);
    },
  );

  it('returns no initial workflow agent without a TeamPack or a roster member', () => {
    const plainRuntime = resolveTeamRuntime({
      conversationId: 'conv-plain-policy',
      presetAgents: [presetAgent],
      activeAgentIds: ['mario'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });
    const missingRoleRuntime = resolveTeamRuntime({
      conversationId: 'conv-missing-role',
      teamPack: {
        ...teamPack,
        workflow: {
          type: 'linear',
          steps: [{ role: 'missing-role', action: 'plan', output: 'plan' }],
        },
      },
      presetAgents: [],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(plainRuntime.initialAgentId).toBeNull();
    expect(missingRoleRuntime.initialAgentId).toBeNull();
  });

  it('preserves the hub-style initial selection for an unknown persisted team mode', () => {
    const runtime = resolveTeamRuntime({
      conversationId: 'conv-legacy-mode',
      teamPack: {
        ...teamPack,
        teamMode: 'retired-mode' as TeamPack['teamMode'],
        workflow: {
          type: 'state_machine',
          states: [{ name: 'start', role: 'reviewer', description: 'Start', transitions: [] }],
        },
      },
      presetAgents: [],
      activeAgentIds: ['planner', 'reviewer'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    expect(runtime.initialAgentId).toBe('reviewer');
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

    expect(runtime.explainHandoffBlock('planner', 'reviewer')).toBeUndefined();
    expect(runtime.explainHandoffBlock('reviewer', 'planner')).toBe('团队协作规则阻止了这次转交');
  });

  it('keeps receive and escalation guidance in the TeamPack prompt', () => {
    const prompt = buildTeamPackLayer('planner', {
      ...teamPack,
      communicationMatrix: {
        ...teamPack.communicationMatrix,
        planner: {
          canSendTo: ['send-only-agent'],
          canReceiveFrom: ['receive-only-agent'],
          canEscalateTo: ['escalation-only-agent'],
        },
      },
    });

    expect(prompt).toContain('- 可以发送消息给：send-only-agent');
    expect(prompt).toContain('- 可以接收来自以下角色的消息：receive-only-agent');
    expect(prompt).toContain('- 可以升级给：escalation-only-agent');
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

    expect(runtime.explainHandoffBlock('peach', 'dk')).toBeUndefined();
    expect(runtime.explainHandoffBlock('peach', 'yoshi')).toBe('团队协作规则阻止了这次转交');
    expect(runtime.explainHandoffBlock('yoshi', 'dk')).toBe('团队协作规则阻止了这次转交');

    const missingPeachMatrix = { ...oldDefaultTeam.communicationMatrix };
    delete missingPeachMatrix.peach;
    const runtimeWithoutSenderRow = resolveTeamRuntime({
      conversationId: 'conv-default-missing-row',
      teamPack: { ...oldDefaultTeam, communicationMatrix: missingPeachMatrix },
      presetAgents: [],
      activeAgentIds: ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'],
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });
    expect(runtimeWithoutSenderRow.explainHandoffBlock('peach', 'dk'))
      .toBe('团队协作规则阻止了这次转交');
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
        hasApiKey: true,
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
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    };

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      { id: 'acc-disabled', provider: 'openai', authMode: 'api_key', enabled: false, status: 'valid', models: ['gpt-5.4'], hasApiKey: true },
      { id: 'acc-enabled', provider: 'anthropic', authMode: 'oauth', enabled: true, status: 'valid', models: [], hasApiKey: false },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'claude', accountId: 'acc-enabled' },
    });
  });

  it('routes an enabled Google account through the OpenCode ACP engine', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [
        {
          id: 'planner',
          displayName: 'Planner',
          source: 'team-pack-role',
          accountIds: ['acc-google'],
          skills: [],
        },
      ],
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    };

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      { id: 'acc-google', provider: 'google', authMode: 'api_key', enabled: true, status: 'valid', models: ['gemini-2.5-pro'], hasApiKey: true },
    ]);

    expect(profile).toMatchObject({
      execution: { engine: 'opencode', accountId: 'acc-google' },
    });
  });

  it('does not select a historical Google OAuth account for OpenCode execution', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [{
        id: 'planner',
        displayName: 'Planner',
        source: 'team-pack-role',
        accountIds: ['acc-google-oauth'],
        skills: [],
      }],
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    };

    expect(resolveRuntimeAgentProfile(runtime, 'planner', [{
      id: 'acc-google-oauth',
      provider: 'google',
      authMode: 'oauth',
      enabled: true,
      status: 'valid',
      models: [],
      hasApiKey: false,
    }])).toBeNull();
  });

  it('does not select an unverified API Key account', () => {
    const runtime: TeamRuntime = {
      conversationId: 'conv-team',
      roster: [{
        id: 'planner', displayName: 'Planner', source: 'team-pack-role',
        accountIds: ['acc-pending'], skills: [],
      }],
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    };

    expect(resolveRuntimeAgentProfile(runtime, 'planner', [{
      id: 'acc-pending', provider: 'kimi', authMode: 'api_key', enabled: true, status: 'pending',
      baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v2'], hasApiKey: true,
    }])).toBeNull();
  });

  it('migrates a legacy explicit gemini engine when no account is enabled', () => {
    const runtime = {
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
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    } as unknown as TeamRuntime;

    const profile = resolveRuntimeAgentProfile(runtime, 'planner', [
      { id: 'acc-disabled', provider: 'openai', authMode: 'api_key', enabled: false, status: 'valid', models: ['gpt-5.4'], hasApiKey: true },
    ]);

    expect(profile).toMatchObject({
      agent: { id: 'planner' },
      execution: { engine: 'opencode' },
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
      explainHandoffBlock: () => undefined,
      initialAgentId: null,
    };

    expect(
      resolveRuntimeAgentProfile(runtime, 'planner', [
        { id: 'acc-disabled', provider: 'openai', authMode: 'api_key', enabled: false, status: 'valid', models: ['gpt-5.4'], hasApiKey: true },
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
