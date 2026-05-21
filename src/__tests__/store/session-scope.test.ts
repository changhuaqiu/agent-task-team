import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';

function account(id: string): Account {
  return {
    id,
    name: id,
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
  };
}

function resetStoreForSessionScope() {
  useTaskHubStore.setState({
    conversations: [
      {
        id: 'conv-old',
        title: 'Old project',
        goal: 'Old goal',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
      },
      {
        id: 'conv-new',
        title: 'New project',
        goal: 'New goal',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
      },
    ],
    selectedConversationId: 'conv-old',
    selectedProjectId: 'conv-old',
    activeAgentIds: ['mario'],
    currentTeamPack: null,
    roleCards: [...PRESET_ROLE_CARDS],
    accounts: [account('acc-openai')],
    agentAccountOverrides: { mario: ['acc-openai'] },
    agentRoleCardOverrides: {},
    agentSkillIds: {},
    skillsMap: {},
    tasks: [],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    agentStatus: {},
    terminalLogs: {},
    activeRunsByAgent: {},
    agentSessions: { 'conv-old': { mario: 'old-cli-session' } },
    needsFullCompose: {},
  });
}

describe('project session scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStoreForSessionScope();
  });

  it('does not send a selected old project session when dispatching to a new conversation', () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    const accepted = useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'start new project',
      conversationId: 'conv-new',
    });

    expect(accepted).toBe(true);
    expect(emitSpy).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      projectId: 'conv-new',
      conversationId: 'conv-new',
      agentId: 'mario',
      sessionId: undefined,
    }));
  });

  it('uses the session cached for the dispatch conversation only', () => {
    useTaskHubStore.setState((state) => ({
      agentSessions: {
        ...state.agentSessions,
        'conv-new': { mario: 'new-cli-session' },
      },
    }));
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'continue new project',
      conversationId: 'conv-new',
    });

    expect(emitSpy).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      projectId: 'conv-new',
      conversationId: 'conv-new',
      agentId: 'mario',
      sessionId: 'new-cli-session',
    }));
  });
});
