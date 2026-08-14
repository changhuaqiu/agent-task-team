import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  useTaskHubStore,
  AGENT_ROSTER,
  type Account,
  type DispatchToAgentInput,
} from '@/store/taskHubStore';
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

const originalDispatchToAgent = useTaskHubStore.getState().dispatchToAgent;

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
    accounts: [],
    dispatchToAgent: originalDispatchToAgent,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Team Pack Dynamic Roster', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
      expect(ids).toContain('peach');
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

    it('does not keep the previous team active when creating a plain project', () => {
      const teamPack = makeTeamPack({
        id: 'pack-old',
        roles: [
          makeRole({ id: 'planner', displayName: 'Planner' }),
          makeRole({ id: 'coder', displayName: 'Coder' }),
        ],
      });
      useTaskHubStore.setState({
        activeAgentIds: ['planner', 'coder'],
        currentTeamPack: teamPack,
      });

      useTaskHubStore.getState().createConversation({
        title: 'Plain Project',
        goal: 'Use preset team',
      });

      const after = useTaskHubStore.getState();
      expect(after.currentTeamPack).toBeNull();
      expect(after.activeAgentIds).toEqual(['mario', 'luigi']);
    });

    it('ignores a stale team-pack response after switching to another project', async () => {
      const oldTeamPack = makeTeamPack({
        id: 'pack-old',
        roles: [makeRole({ id: 'planner', displayName: 'Planner' })],
      });
      let resolveOldPack: (value: any) => void = () => {};
      const oldPackPromise = new Promise((resolve) => {
        resolveOldPack = resolve;
      });
      vi.spyOn(global, 'fetch').mockImplementation((url: string | URL | Request) => {
        const href = String(url);
        if (href.includes('/api/team-packs/pack-old')) {
          return oldPackPromise as Promise<any>;
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as any);
      });

      const store = useTaskHubStore.getState();
      store.createConversation({ title: 'Team Project', goal: 'Use team', teamPackId: 'pack-old' });
      const teamConversationId = useTaskHubStore.getState().selectedConversationId;
      expect(teamConversationId).toBeTruthy();

      store.createConversation({ title: 'Plain Project', goal: 'No team' });
      const plainConversationId = useTaskHubStore.getState().selectedConversationId;
      expect(plainConversationId).not.toBe(teamConversationId);

      resolveOldPack({
        ok: true,
        json: () => Promise.resolve(oldTeamPack),
      });
      await oldPackPromise;
      await Promise.resolve();
      await Promise.resolve();

      const after = useTaskHubStore.getState();
      expect(after.selectedConversationId).toBe(plainConversationId);
      expect(after.currentTeamPack).toBeNull();
      expect(after.activeAgentIds).toEqual(['mario', 'luigi']);
    });

    it('dispatches the selected team pack initial role for project analysis', () => {
      const dispatchToAgent = vi.fn();
      const teamPack = makeTeamPack({
        id: 'pack-planner',
        roles: [
          makeRole({ id: 'planner', displayName: 'Planner', accountIds: ['acc-planner'] }),
          makeRole({ id: 'coder', displayName: 'Coder', accountIds: ['acc-coder'] }),
        ],
        workflow: {
          type: 'state_machine',
          states: [
            { name: 'planning', role: 'planner', description: 'Plan first', transitions: [] },
            { name: 'coding', role: 'coder', description: 'Code next', transitions: [] },
          ],
        },
      });

      useTaskHubStore.setState({
        conversations: [{
          id: 'conv-team',
          title: 'Team Project',
          goal: 'Use the selected team',
          status: 'active',
          priority: 'p1',
          projectPath: '',
          breakdownStatus: 'none',
          teamPackId: 'pack-planner',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        selectedConversationId: 'conv-team',
        activeAgentIds: ['planner', 'coder'],
        currentTeamPack: teamPack,
        accounts: [makeAccount('acc-planner'), makeAccount('acc-coder')],
        dispatchToAgent: dispatchToAgent as any,
      });

      useTaskHubStore.getState().triggerProposal('conv-team');

      expect(dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'planner',
        conversationId: 'conv-team',
      }));
      expect(dispatchToAgent).not.toHaveBeenCalledWith(expect.objectContaining({ agentId: 'mario' }));
    });

    it('waits for the team pack before auto-starting project analysis', async () => {
      vi.useFakeTimers();
      const dispatchToAgent = vi.fn();
      const teamPack = makeTeamPack({
        id: 'pack-auto',
        roles: [makeRole({ id: 'researcher', displayName: 'Researcher', accountIds: ['acc-researcher'] })],
        workflow: {
          type: 'linear',
          steps: [{ role: 'researcher', action: 'Research first', output: 'Notes' }],
        },
      });

      vi.spyOn(global, 'fetch').mockImplementation((url: string | URL | Request) => {
        const href = String(url);
        if (href.includes('/api/team-packs/pack-auto')) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(teamPack) } as any);
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as any);
      });

      useTaskHubStore.setState({
        accounts: [makeAccount('acc-researcher')],
        dispatchToAgent: dispatchToAgent as any,
      });

      useTaskHubStore.getState().createConversation({
        title: 'Research Project',
        goal: 'Use research team',
        teamPackId: 'pack-auto',
      });

      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);

      expect(dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'researcher',
      }));
      expect(dispatchToAgent).not.toHaveBeenCalledWith(expect.objectContaining({ agentId: 'mario' }));
      vi.useRealTimers();
    });

    it('does not start a legacy proposal for autonomous Team Pack projects', async () => {
      vi.useFakeTimers();
      const dispatchToAgent = vi.fn(async (_input: DispatchToAgentInput) => true);
      const teamPack = makeTeamPack({
        id: 'pack-autonomous',
        roles: [makeRole({ id: 'planner', displayName: 'Planner', accountIds: ['acc-planner'] })],
      });

      vi.spyOn(global, 'fetch').mockImplementation((url: string | URL | Request) => {
        const href = String(url);
        if (href.includes('/api/team-packs/pack-autonomous')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(teamPack),
          } as unknown as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        } as unknown as Response);
      });

      useTaskHubStore.setState({
        accounts: [makeAccount('acc-planner')],
        dispatchToAgent,
      });

      await useTaskHubStore.getState().createConversation({
        title: 'Autonomous Project',
        goal: 'Let the delivery supervisor plan the work',
        teamPackId: 'pack-autonomous',
        autonomous: true,
      });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(500);

      expect(useTaskHubStore.getState().currentTeamPack?.id).toBe('pack-autonomous');
      expect(useTaskHubStore.getState().conversations[0]?.autonomous).toBe(true);
      expect(dispatchToAgent).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('blocks direct and delayed legacy proposals in an autonomous conversation', async () => {
      vi.useFakeTimers();
      const dispatchToAgent = vi.fn(async (_input: DispatchToAgentInput) => true);
      const teamPack = makeTeamPack({
        id: 'pack-hydrated-autonomous',
        roles: [makeRole({ id: 'planner', displayName: 'Planner', accountIds: ['acc-planner'] })],
      });
      vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
      useTaskHubStore.setState({
        conversations: [{
          id: 'conv-hydrated-autonomous',
          title: 'Hydrated autonomous project',
          goal: 'Keep planning under the delivery supervisor',
          status: 'active',
          priority: 'p1',
          projectPath: 'C:/fixture',
          breakdownStatus: 'none',
          autonomous: true,
          teamPackId: teamPack.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        selectedConversationId: 'conv-hydrated-autonomous',
        currentTeamPack: teamPack,
        activeAgentIds: ['planner'],
        accounts: [makeAccount('acc-planner')],
        dispatchToAgent,
      });

      await useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: '补充一个普通说明，不进行人工路由',
      });
      await vi.advanceTimersByTimeAsync(500);
      useTaskHubStore.getState().triggerProposal('conv-hydrated-autonomous');

      expect(dispatchToAgent).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('human mentions in TeamPack projects', () => {
    it('persists the user message before submitting durable work when the target is busy', async () => {
      const dispatchToAgent = vi.fn();
      const enqueueDispatch = vi.fn();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'message-server-1' } }),
      } as Response);
      const teamPack = makeTeamPack({
        id: 'pack-busy-mentions',
        roles: [makeRole({ id: 'coder', displayName: 'Coder' })],
      });
      useTaskHubStore.setState({
        conversations: [{
          id: 'conv-busy-mentions',
          title: 'Busy Mentions',
          goal: 'Queue without losing chat facts',
          status: 'active',
          priority: 'p1',
          projectPath: '',
          breakdownStatus: 'none',
          teamPackId: 'pack-busy-mentions',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        selectedConversationId: 'conv-busy-mentions',
        activeAgentIds: ['coder'],
        currentTeamPack: teamPack,
        agentStatus: { coder: 'busy' },
        dispatchToAgent: dispatchToAgent as any,
        enqueueDispatch: enqueueDispatch as any,
      });

      await useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: '@coder 请排队执行',
      });

      expect(useTaskHubStore.getState().chatMessagesByConversation['conv-busy-mentions'])
        .toContainEqual(expect.objectContaining({ agentId: 'human', content: '@coder 请排队执行' }));
      expect(enqueueDispatch).not.toHaveBeenCalled();
      expect(dispatchToAgent).not.toHaveBeenCalled();
      expect(fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
        expect.objectContaining({ type: 'message.append' }),
        expect.objectContaining({
          type: 'a2a.human_handoff',
          payload: expect.objectContaining({
            conversationId: 'conv-busy-mentions',
            messageId: 'message-server-1',
            targetAgentIds: ['coder'],
          }),
        }),
      ]);
    });

    it('submits dynamic TeamPack role ids through the Human A2A command', async () => {
      const dispatchToAgent = vi.fn();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'message-server-2' } }),
      } as Response);
      const teamPack = makeTeamPack({
        id: 'pack-mentions',
        roles: [
          makeRole({ id: 'planner', displayName: '规划师' }),
          makeRole({ id: 'coder', displayName: '实现者' }),
        ],
      });
      useTaskHubStore.setState({
        conversations: [{
          id: 'conv-mentions',
          title: 'Team Mentions',
          goal: 'Use dynamic mentions',
          status: 'active',
          priority: 'p1',
          projectPath: '',
          breakdownStatus: 'none',
          teamPackId: 'pack-mentions',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        selectedConversationId: 'conv-mentions',
        activeAgentIds: ['planner', 'coder'],
        currentTeamPack: teamPack,
        dispatchToAgent: dispatchToAgent as any,
      });

      await useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: '@planner 请先分析这个项目',
      });

      expect(dispatchToAgent).not.toHaveBeenCalled();
      expect(fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body))))
        .toContainEqual(expect.objectContaining({
          type: 'a2a.human_handoff',
          payload: expect.objectContaining({
            conversationId: 'conv-mentions',
            targetAgentIds: ['planner'],
          }),
        }));
    });

    it('resolves CJK display names before submitting the Human A2A command', async () => {
      const dispatchToAgent = vi.fn();
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'message-server-3' } }),
      } as Response);
      const teamPack = makeTeamPack({
        id: 'pack-cjk-mentions',
        roles: [
          makeRole({ id: 'planner', displayName: '规划师' }),
          makeRole({ id: 'coder', displayName: '实现者' }),
        ],
      });
      useTaskHubStore.setState({
        conversations: [{
          id: 'conv-cjk-mentions',
          title: 'CJK Mentions',
          goal: 'Use display name mentions',
          status: 'active',
          priority: 'p1',
          projectPath: '',
          breakdownStatus: 'none',
          teamPackId: 'pack-cjk-mentions',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
        selectedConversationId: 'conv-cjk-mentions',
        activeAgentIds: ['planner', 'coder'],
        currentTeamPack: teamPack,
        dispatchToAgent: dispatchToAgent as any,
      });

      await useTaskHubStore.getState().addChatMessage({
        agentId: 'human',
        content: '@规划师 请先分析这个项目',
      });

      expect(dispatchToAgent).not.toHaveBeenCalled();
      expect(fetchSpy.mock.calls.map(([, init]) => JSON.parse(String(init?.body))))
        .toContainEqual(expect.objectContaining({
          type: 'a2a.human_handoff',
          payload: expect.objectContaining({
            conversationId: 'conv-cjk-mentions',
            targetAgentIds: ['planner'],
          }),
        }));
    });

    it('restores the optimistic project removal when the server delete fails', async () => {
      const conversation = {
        id: 'conv-delete-failed',
        title: 'Delete failure',
        goal: 'Keep local and server state aligned',
        status: 'active' as const,
        priority: 'p1' as const,
        projectPath: '',
        breakdownStatus: 'none' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const task = {
        id: 'TASK-DELETE-FAILED',
        conversationId: conversation.id,
        phaseId: '',
        title: 'Existing task',
        description: '',
        status: 'pending' as const,
        agentId: 'mario',
        dependencies: [],
        artifacts: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      useTaskHubStore.setState({
        conversations: [conversation],
        selectedConversationId: conversation.id,
        selectedProjectId: conversation.id,
        tasks: [task],
        chatMessagesByConversation: {
          [conversation.id]: [{
            id: 'msg-delete-failed',
            conversationId: conversation.id,
            agentId: 'human',
            content: 'keep me',
            timestamp: new Date().toISOString(),
          }],
        },
      });
      vi.spyOn(global, 'fetch').mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'foreign key blocked delete' }),
      } as Response);

      const deleted = await useTaskHubStore.getState().deleteConversation(conversation.id);

      expect(deleted).toBe(false);
      const restored = useTaskHubStore.getState();
      expect(restored.selectedConversationId).toBe(conversation.id);
      expect(restored.conversations).toContainEqual(conversation);
      expect(restored.tasks).toContainEqual(task);
      expect(restored.chatMessagesByConversation[conversation.id]).toHaveLength(1);
    });
  });
});
