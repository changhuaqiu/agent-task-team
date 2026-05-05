import { describe, it, expect, beforeEach } from 'vitest';
import { useTaskHubStore, AGENT_ROSTER } from '@/store/taskHubStore';
import type { TeamPack, TeamPackRole } from '@/types/teamPack';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTeamPack(overrides: Partial<TeamPack> & { id: string; roles: TeamPackRole[] }): TeamPack {
  return {
    specVersion: 'team-pack/0.1',
    name: overrides.id,
    displayName: overrides.name ?? 'Test Pack',
    description: '',
    version: '1.0.0',
    tags: [],
    category: 'test',
    teamMode: 'pipeline',
    workflow: { type: 'linear' },
    communicationMatrix: {},
    isPreset: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeRole(overrides: Partial<TeamPackRole> & { id: string }): TeamPackRole {
  return {
    displayName: overrides.id,
    soul: '',
    required: true,
    ...overrides,
  };
}

function resetStore() {
  useTaskHubStore.setState({
    conversations: [],
    selectedConversationId: null,
    tasks: [],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    blockersByConversation: {},
    activeAgentIds: ['mario', 'luigi'],
    currentTeamPack: null,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Team Pack Dynamic Roster', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('getEffectiveRoster', () => {
    it('effectiveRoster includes team pack roles not in AGENT_ROSTER', () => {
      const roles = [
        makeRole({ id: 'planner', displayName: 'Planner' }),
        makeRole({ id: 'coder', displayName: 'Coder' }),
        makeRole({ id: 'reviewer', displayName: 'Reviewer' }),
      ];
      const teamPack = makeTeamPack({ id: 'pack-1', roles });

      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-1',
            title: 'Test',
            goal: 'Test',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            teamPackId: 'pack-1',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-1',
        activeAgentIds: ['planner', 'coder', 'reviewer'],
        currentTeamPack: teamPack,
      });

      const roster = useTaskHubStore.getState().getEffectiveRoster();
      const ids = roster.map((a) => a.id);

      expect(ids).toContain('planner');
      expect(ids).toContain('coder');
      expect(ids).toContain('reviewer');

      const planner = roster.find((a) => a.id === 'planner')!;
      expect(planner.emoji).toBeDefined();
      expect(planner.theme).toBeDefined();
      expect(planner.name).toBe('Planner');
    });

    it('effectiveRoster merges team pack roles with AGENT_ROSTER', () => {
      const roles = [
        makeRole({ id: 'mario', displayName: 'Super Planner' }),
        makeRole({ id: 'newagent', displayName: 'New Agent' }),
      ];
      const teamPack = makeTeamPack({ id: 'pack-2', roles });

      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-2',
            title: 'Test',
            goal: 'Test',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            teamPackId: 'pack-2',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-2',
        activeAgentIds: ['mario', 'newagent'],
        currentTeamPack: teamPack,
      });

      const roster = useTaskHubStore.getState().getEffectiveRoster();
      const ids = roster.map((a) => a.id);

      const marios = roster.filter((a) => a.id === 'mario');
      expect(marios).toHaveLength(1);
      expect(marios[0].name).toBe('Super Planner');

      expect(ids).toContain('newagent');

      expect(ids).toContain('luigi');
      expect(ids).toContain('toad');
    });

    it('effectiveRoster falls back to AGENT_ROSTER when no team pack', () => {
      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-3',
            title: 'Test',
            goal: 'Test',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-3',
        currentTeamPack: null,
      });

      const roster = useTaskHubStore.getState().getEffectiveRoster();
      expect(roster.map((a) => a.id)).toEqual(AGENT_ROSTER.map((a) => a.id));
    });

    it('effectiveRoster falls back to AGENT_ROSTER when no conversation selected', () => {
      useTaskHubStore.setState({
        selectedConversationId: null,
        currentTeamPack: null,
      });

      const roster = useTaskHubStore.getState().getEffectiveRoster();

      expect(roster.map((a) => a.id)).toEqual(AGENT_ROSTER.map((a) => a.id));
    });

    it('active agents are listed before inactive agents in effective roster', () => {
      const roles = [
        makeRole({ id: 'planner', displayName: 'Planner' }),
        makeRole({ id: 'coder', displayName: 'Coder' }),
      ];
      const teamPack = makeTeamPack({ id: 'pack-active', roles });

      useTaskHubStore.setState({
        conversations: [
          {
            id: 'conv-active',
            title: 'Test',
            goal: 'Test',
            status: 'active',
            priority: 'p1',
            projectPath: '',
            breakdownStatus: 'none',
            teamPackId: 'pack-active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
        selectedConversationId: 'conv-active',
        activeAgentIds: ['coder'],
        currentTeamPack: teamPack,
      });

      const roster = useTaskHubStore.getState().getEffectiveRoster();

      expect(roster[0].id).toBe('coder');

      const plannerIdx = roster.findIndex((a) => a.id === 'planner');
      expect(plannerIdx).toBeGreaterThan(0);
    });
  });

  describe('createConversation with teamPackId', () => {
    it('sets selectedConversationId and creates conversation with teamPackId', () => {
      const store = useTaskHubStore.getState();

      store.createConversation({
        title: 'Team Pack Project',
        goal: 'Build with a team pack',
        teamPackId: 'pack-test',
      });

      const after = useTaskHubStore.getState();
      expect(after.selectedConversationId).not.toBeNull();

      const conv = after.conversations.find((c) => c.id === after.selectedConversationId);
      expect(conv).toBeDefined();
      expect(conv!.teamPackId).toBe('pack-test');
    });
  });
});
