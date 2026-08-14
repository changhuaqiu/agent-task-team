import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import { socket } from '@/store/daemonStore';
import type { TeamPack, TeamPackRole, RoleCardSnapshot } from '@/types/teamPack';
import type { RoleCard } from '@/types/roleCard';

function makeRole(overrides: Partial<TeamPackRole> & { id: string }): TeamPackRole {
  return { displayName: overrides.id, soul: '', required: true, ...overrides };
}

function makeTeamPack(id: string, roles: TeamPackRole[]): TeamPack {
  return {
    id,
    specVersion: 'team-pack/0.1',
    name: id,
    displayName: id,
    description: '',
    version: '1.0.0',
    tags: [],
    category: 'test',
    roles,
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {},
    isPreset: false,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  };
}

function makeAccount(id: string): Account {
  return {
    id,
    name: id,
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    hasApiKey: true,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
  };
}

function makeRoleCard(overrides: Partial<RoleCard> = {}): RoleCard {
  return {
    id: 'rc-stable-planner',
    name: 'stable-planner',
    displayName: 'Planner Card',
    description: 'Stable planner role card for compatibility tests.',
    category: 'planner',
    tags: ['planning'],
    applicableScenarios: ['Planning'],
    responsibilities: ['Plan work'],
    nonResponsibilities: [],
    successCriteria: ['Plan is clear'],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'structured',
    preferStructuredOutput: true,
    allowedActions: ['can_propose_only'],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: ['acc-global'],
    outputFormat: 'checklist',
    requiresEvidence: true,
    riskGrading: 'optional',
    isPreset: false,
    version: 1,
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
    ...overrides,
  };
}

const originalFetch = global.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-team',
      title: 'Team project',
      goal: 'Test',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      teamPackId: 'pack-team',
      createdAt: '2026-05-06T00:00:00.000Z',
      updatedAt: '2026-05-06T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-team',
    selectedProjectId: 'conv-team',
    activeAgentIds: ['planner'],
    currentTeamPack: makeTeamPack('pack-team', [makeRole({ id: 'planner', displayName: '规划师' })]),
    roleCards: [makeRoleCard()],
    accounts: [makeAccount('acc-openai')],
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
    agentSkillIds: {},
    skillsMap: {},
    tasks: [],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    agentStatus: {},
    terminalLogs: {},
    activeRunsByAgent: {},
    needsFullCompose: {},
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('team role card compatibility', () => {
  it('resolves a dynamic Team Pack role from effective roster', () => {
    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');
    const roster = useTaskHubStore.getState().getEffectiveRoster();

    expect(profile).toBeNull();
    expect(roster.find((agent) => agent.id === 'planner')).toMatchObject({
      id: 'planner',
      name: '规划师',
      accountIds: [],
    });
  });

  it('uses agent account overrides when no RoleCard exists', () => {
    useTaskHubStore.setState({ agentAccountOverrides: { planner: ['acc-openai'] } });

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.agent.accountIds).toEqual(['acc-openai']);
    expect(profile?.execution).toMatchObject({ engine: 'codex', accountId: 'acc-openai' });
  });

  it('uses role card override accounts before agent account overrides', () => {
    useTaskHubStore.setState((state) => ({
      roleCards: [{
        ...state.roleCards[0],
        id: 'rc-planner',
        displayName: 'Planner Card',
        accountIds: ['acc-role'],
      }, ...state.roleCards],
      accounts: [makeAccount('acc-role'), ...state.accounts],
      agentRoleCardOverrides: { planner: 'rc-planner' },
      agentAccountOverrides: { planner: ['acc-openai'] },
    }));

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.prompt.roleCard?.id).toBe('rc-planner');
    expect(profile?.agent.accountIds).toEqual(['acc-role']);
  });

  it('stores role card switching for dynamic roles in overrides', () => {
    const cardId = useTaskHubStore.getState().roleCards[0].id;

    useTaskHubStore.setState((state) => ({
      accounts: [makeAccount('acc-global'), ...state.accounts],
    }));
    useTaskHubStore.getState().setAgentRoleCardId('planner', cardId);

    const state = useTaskHubStore.getState();
    expect(state.agentRoleCardOverrides.planner).toBe(cardId);
    expect(state.getAgentRuntimeProfile('planner')?.prompt.roleCard?.id).toBe(cardId);
  });

  it('loads skill assignments for effective roster IDs', async () => {
    const calls: string[] = [];
    global.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url === '/api/skills') {
        return new Response(JSON.stringify([{ id: 'skill-1', name: 'Skill 1', content: 'Use skill 1', files: [] }]), { status: 200 });
      }
      if (url === '/api/agents/planner/skills') {
        return new Response(JSON.stringify([{ id: 'skill-1', name: 'Skill 1', content: 'Use skill 1', files: [] }]), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await useTaskHubStore.getState().loadSkills();

    expect(calls).toContain('/api/agents/planner/skills');
    expect(useTaskHubStore.getState().agentSkillIds.planner).toEqual(['skill-1']);
  });

  it('prefers TeamPack role snapshot and member bindings over global role cards', () => {
    const baseCard = makeRoleCard();
    const snapshot = {
      name: 'stable-planner',
      displayName: '团队内规划师',
      description: 'Stable planner role card for compatibility tests.',
      category: 'planner',
      tags: ['planning'],
      applicableScenarios: ['Planning'],
      responsibilities: ['Plan work'],
      nonResponsibilities: [],
      successCriteria: ['Plan is clear'],
      clarifyBeforeExecute: 'when_ambiguous',
      outputStyle: 'structured',
      preferStructuredOutput: true,
      allowedActions: ['can_propose_only'],
      requiresConfirmation: [],
      forbiddenActions: [],
      preferredEngines: [],
      allowedTools: [],
      accountIds: ['acc-snapshot'],
      outputFormat: 'checklist',
      requiresEvidence: true,
      riskGrading: 'optional',
      sourceRoleCardId: baseCard.id,
      snapshotVersion: 1,
      snapshottedAt: '2026-05-06T00:00:00.000Z',
    } satisfies RoleCardSnapshot;

    useTaskHubStore.setState({
      accounts: [makeAccount('acc-team'), ...useTaskHubStore.getState().accounts],
      roleCards: [baseCard],
      currentTeamPack: makeTeamPack('pack-team', [{
        ...makeRole({ id: 'planner', displayName: '规划师' }),
        roleCardId: baseCard.id,
        roleCardSnapshot: snapshot,
        accountIds: ['acc-team'],
        skillIds: ['skill-team'],
      }]),
      skillsMap: {
        'skill-team': {
          name: 'Team Skill',
          content: 'Use team-owned skill.',
        },
      },
    });

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.prompt.roleCard?.displayName).toBe('团队内规划师');
    expect(profile?.agent.accountIds).toEqual(['acc-team']);
    expect(profile?.prompt.skills.map((s) => s.name)).toEqual(['Team Skill']);
  });

  it('resolves execution from an enabled account override for a dynamic role', () => {
    useTaskHubStore.setState({ agentAccountOverrides: { planner: ['acc-openai'] } });

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.execution.engine).toBe('codex');
    expect(profile?.execution.accountId).toBe('acc-openai');
  });

  it('reuses cached effective roster until runtime inputs change', () => {
    const state = useTaskHubStore.getState();
    const firstRoster = state.getEffectiveRoster();
    const secondRoster = state.getEffectiveRoster();

    expect(secondRoster).toBe(firstRoster);

    useTaskHubStore.setState((current) => ({
      roleCards: [...current.roleCards],
    }));

    expect(useTaskHubStore.getState().getEffectiveRoster()).not.toBe(firstRoster);
  });

  it('reuses cached runtime profiles until account inputs change', () => {
    useTaskHubStore.setState({ agentAccountOverrides: { planner: ['acc-openai'] } });

    const state = useTaskHubStore.getState();
    const firstProfile = state.getAgentRuntimeProfile('planner');
    const secondProfile = state.getAgentRuntimeProfile('planner');

    expect(secondProfile).toBe(firstProfile);

    useTaskHubStore.setState((current) => ({
      accounts: [...current.accounts],
    }));

    expect(useTaskHubStore.getState().getAgentRuntimeProfile('planner')).not.toBe(firstProfile);
  });

  it('records an aborted invocation and shows recovery guidance when a user dispatch has no executable profile', async () => {
    const emitSpy = vi.spyOn(socket, 'emit');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'planner',
      prompt: 'Draft a plan',
      conversationId: 'conv-team',
    });

    const state = useTaskHubStore.getState();
    expect(state.agentStatus.planner).not.toBe('busy');
    expect(state.activeRunsByAgent.planner).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    expect(state.eventsByConversation['conv-team']).toContainEqual(expect.objectContaining({
      type: 'invocation.aborted',
      conversationId: 'conv-team',
      payload: {
        agentId: 'planner',
        reasonCode: 'no_runtime_profile',
        message: '请先为该角色绑定可用账号或执行引擎',
      },
    }));
    expect(state.chatMessagesByConversation['conv-team']).toContainEqual(expect.objectContaining({
      agentId: 'system',
      content: '@planner 未启动：请先为该角色绑定可用账号或执行引擎。',
    }));
  });

  it('does not register an A2A executing chain when user mention dispatch is rejected', () => {
    const emitSpy = vi.spyOn(socket, 'emit');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    useTaskHubStore.getState().addChatMessage({
      agentId: 'human',
      content: '@planner Draft a plan',
      conversationId: 'conv-team',
    });

    expect(emitSpy).not.toHaveBeenCalledWith('a2a:user-turn-created', expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith('a2a:user-turn-created', expect.objectContaining({
      targetAgentIds: ['planner'],
    }));
    expect(useTaskHubStore.getState().agentStatus.planner).not.toBe('busy');
  });

  it('records an aborted invocation event when simulating a task for a dynamic role without an executable profile', () => {
    const emitSpy = vi.spyOn(socket, 'emit');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useTaskHubStore.setState({
      tasks: [{
        id: 'task-plan',
        conversationId: 'conv-team',
        phaseId: '',
        title: 'Plan work',
        description: 'Draft a plan',
        status: 'pending',
        agentId: 'planner',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:00:00.000Z',
      }],
    });

    useTaskHubStore.getState().simulateCliExecution('task-plan', 'Draft a plan');

    const state = useTaskHubStore.getState();
    expect(state.agentStatus.planner).not.toBe('busy');
    expect(state.activeRunsByAgent.planner).toBeUndefined();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    expect(state.eventsByConversation['conv-team']).toContainEqual(expect.objectContaining({
      type: 'invocation.aborted',
      conversationId: 'conv-team',
      payload: {
        agentId: 'planner',
        reasonCode: 'no_runtime_profile',
        message: '请先为该角色绑定可用账号或执行引擎',
      },
    }));
  });

  it('persists dynamic team role account bindings through the team role API', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({
        role: {
          ...useTaskHubStore.getState().currentTeamPack!.roles[0],
          accountIds: ['acc-openai'],
        },
      }), { status: 200 });
    }) as typeof fetch;

    await useTaskHubStore.getState().setTeamRoleAccountIds('planner', ['acc-openai']);

    expect(calls).toEqual([{
      url: '/api/team-packs/pack-team/roles/planner',
      body: { accountIds: ['acc-openai'] },
    }]);
    expect(useTaskHubStore.getState().currentTeamPack?.roles[0].accountIds).toEqual(['acc-openai']);
  });

  it('falls back to preset agent account overrides when a loaded TeamPack does not contain the agent', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    await useTaskHubStore.getState().setTeamRoleAccountIds('mario', ['acc-openai']);

    expect(useTaskHubStore.getState().agentAccountOverrides.mario).toEqual(['acc-openai']);
    expect(calls.some((call) => call.url === '/api/team-packs/pack-team/roles/mario')).toBe(false);
  });

  it('falls back to preset agent skill assignments when a loaded TeamPack does not contain the agent', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify([]), { status: 200 });
    }) as typeof fetch;

    await useTaskHubStore.getState().setTeamRoleSkillIds('mario', ['skill-review']);

    expect(calls).toContainEqual({
      url: '/api/agents/mario/skills',
      body: { skillIds: ['skill-review'] },
    });
    expect(calls.some((call) => call.url === '/api/team-packs/pack-team/roles/mario')).toBe(false);
    expect(useTaskHubStore.getState().agentSkillIds.mario).toEqual(['skill-review']);
  });

  it('falls back to preset agent role card overrides when a loaded TeamPack does not contain the agent', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;

    await useTaskHubStore.getState().setTeamRoleCardSnapshot('mario', 'rc-stable-planner');

    expect(useTaskHubStore.getState().agentRoleCardOverrides.mario).toBe('rc-stable-planner');
    expect(calls.some((call) => call.url === '/api/team-packs/pack-team/roles/mario')).toBe(false);
  });
});
