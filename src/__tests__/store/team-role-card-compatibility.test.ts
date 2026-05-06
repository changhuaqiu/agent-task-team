import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';
import type { TeamPack, TeamPackRole } from '@/types/teamPack';

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
    createdAt: '2026-05-06T00:00:00.000Z',
    updatedAt: '2026-05-06T00:00:00.000Z',
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
    accounts: [makeAccount('acc-openai')],
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
    agentSkillIds: {},
    skillsMap: {},
    tasks: [],
    chatMessagesByConversation: {},
    needsFullCompose: {},
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('team role card compatibility', () => {
  it('resolves a dynamic Team Pack role from effective roster', () => {
    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.agent.id).toBe('planner');
    expect(profile?.agent.name).toBe('规划师');
    expect(profile?.roleCard).toBeUndefined();
    expect(profile?.accountIds).toEqual([]);
  });

  it('uses agent account overrides when no RoleCard exists', () => {
    useTaskHubStore.setState({ agentAccountOverrides: { planner: ['acc-openai'] } });

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.accountIds).toEqual(['acc-openai']);
  });

  it('uses role card override accounts before agent account overrides', () => {
    useTaskHubStore.setState((state) => ({
      roleCards: [{
        ...state.roleCards[0],
        id: 'rc-planner',
        displayName: 'Planner Card',
        accountIds: ['acc-role'],
      }, ...state.roleCards],
      agentRoleCardOverrides: { planner: 'rc-planner' },
      agentAccountOverrides: { planner: ['acc-openai'] },
    }));

    const profile = useTaskHubStore.getState().getAgentRuntimeProfile('planner');

    expect(profile?.roleCard?.id).toBe('rc-planner');
    expect(profile?.accountIds).toEqual(['acc-role']);
  });

  it('stores role card switching for dynamic roles in overrides', () => {
    const cardId = useTaskHubStore.getState().roleCards[0].id;

    useTaskHubStore.getState().setAgentRoleCardId('planner', cardId);

    const state = useTaskHubStore.getState();
    expect(state.agentRoleCardOverrides.planner).toBe(cardId);
    expect(state.getAgentRuntimeProfile('planner')?.roleCard?.id).toBe(cardId);
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
});
