import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function account(id: string): Account {
  return {
    id,
    name: id,
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    hasApiKey: true,
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
    pendingDispatches: {},
    agentSessions: { 'conv-old': { mario: 'old-cli-session' } },
    needsFullCompose: {},
  });
}

describe('project session scoping', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStoreForSessionScope();
  });

  it('does not send browser-cached session identity for a new conversation', async () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    const accepted = await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'start new project',
      conversationId: 'conv-new',
    });

    expect(accepted).toBe(true);
    const payload = emitSpy.mock.calls.find(([event]) => event === 'terminal:start')?.[1];
    expect(payload).toEqual(expect.objectContaining({
      projectId: 'conv-new',
      conversationId: 'conv-new',
      agentId: 'mario',
      accountId: 'acc-openai',
    }));
    expect(payload).not.toHaveProperty('sessionId');
    expect(payload).not.toHaveProperty('providerProfileId');
    expect(payload).not.toHaveProperty('channel');
    expect(payload).not.toHaveProperty('authContextId');
    expect(payload).not.toHaveProperty('accountIds');
    expect(payload).not.toHaveProperty('allowMockRunner');
  });

  it('does not let a browser cache choose the server runtime session', async () => {
    useTaskHubStore.setState((state) => ({
      agentSessions: {
        ...state.agentSessions,
        'conv-new': { mario: 'new-cli-session' },
      },
    }));
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'continue new project',
      conversationId: 'conv-new',
    });

    const payload = emitSpy.mock.calls.find(([event]) => event === 'terminal:start')?.[1];
    expect(payload).toEqual(expect.objectContaining({
      projectId: 'conv-new',
      conversationId: 'conv-new',
      agentId: 'mario',
    }));
    expect(payload).not.toHaveProperty('sessionId');
  });

  it('keeps the simulated terminal command free of retired routing fields', () => {
    useTaskHubStore.setState({
      tasks: [{
        id: 'task-simulated',
        conversationId: 'conv-new',
        phaseId: '',
        title: 'Simulated task',
        description: 'Run the simulated task',
        status: 'pending',
        agentId: 'mario',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
      }],
    });
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    useTaskHubStore.getState().simulateCliExecution('task-simulated', 'run it');

    const payload = emitSpy.mock.calls.find(([event]) => event === 'terminal:start')?.[1];
    expect(payload).toEqual(expect.objectContaining({
      projectId: 'conv-new',
      conversationId: 'conv-new',
      agentId: 'mario',
      accountId: 'acc-openai',
    }));
    expect(payload).not.toHaveProperty('providerProfileId');
    expect(payload).not.toHaveProperty('channel');
    expect(payload).not.toHaveProperty('authContextId');
    expect(payload).not.toHaveProperty('accountIds');
    expect(payload).not.toHaveProperty('allowMockRunner');
  });

  it('does not turn a display error back into a browser-side retry command', async () => {
    vi.spyOn(socket, 'emit').mockImplementation(() => socket);
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    const accepted = await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'race-safe user turn',
      referencedTaskId: 'TASK-QUEUE',
      conversationId: 'conv-new',
    });
    expect(accepted).toBe(true);

    emitServerEvent('command:error', {
      projectId: 'conv-old',
      command: 'terminal:start',
      agentId: 'mario',
      message: 'Agent is busy, message queued',
      reasonCode: 'agent_busy',
    });

    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toBeUndefined();
    const enqueueCall = fetchSpy.mock.calls.find(([, init]) => String(init?.body).includes('dispatch.enqueue'));
    expect(enqueueCall).toBeUndefined();
  });

  it('hydrates the browser queue as a scoped projection of Agent Inbox', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [{
        id: 'inbox-1',
        projectAgentId: 'mario',
        idempotencyKey: 'server-command-1',
        command: { source: 'workflow', prompt: 'Persisted work', taskId: 'TASK-1' },
        createdAt: '2026-05-17T00:01:00.000Z',
      }],
    } as Response);

    useTaskHubStore.setState({
      pendingDispatches: {
        'mario:conv-new': [{
          idempotencyKey: 'local-unconfirmed',
          persistenceStatus: 'failed',
          prompt: 'Retry locally',
          conversationId: 'conv-new',
          queuedAt: '2026-05-17T00:00:30.000Z',
        }],
      },
    });
    await useTaskHubStore.getState().refreshPendingDispatches('conv-new');

    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toEqual([
      expect.objectContaining({
        idempotencyKey: 'local-unconfirmed',
        persistenceStatus: 'failed',
      }),
      expect.objectContaining({
        inboxItemId: 'inbox-1',
        idempotencyKey: 'server-command-1',
        persistenceStatus: 'persisted',
        conversationId: 'conv-new',
        prompt: 'Persisted work',
      }),
    ]);
  });

  it('confirms a failed persistence outcome with the server before removing it', async () => {
    useTaskHubStore.setState({
      pendingDispatches: {
        'mario:conv-new': [{
          idempotencyKey: 'unknown-outcome',
          persistenceStatus: 'failed',
          prompt: 'May already be durable',
          conversationId: 'conv-new',
          queuedAt: '2026-05-17T00:00:30.000Z',
        }],
      },
    });
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { cancelled: 1, status: 'cancelled' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

    await useTaskHubStore.getState().clearPendingDispatches(
      'mario',
      'conv-new',
      'unknown-outcome',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(String(fetchSpy.mock.calls[0][1]?.body)).toContain('dispatch.cancel');
    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toBeUndefined();
  });

  it('removes a failed local projection when the server confirms a terminal item', async () => {
    useTaskHubStore.setState({
      pendingDispatches: {
        'mario:conv-new': [{
          idempotencyKey: 'already-completed',
          persistenceStatus: 'failed',
          prompt: 'Completed remotely',
          conversationId: 'conv-new',
          queuedAt: '2026-05-17T00:00:30.000Z',
        }],
      },
    });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { cancelled: 0, status: 'completed' } }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response);

    await useTaskHubStore.getState().clearPendingDispatches(
      'mario',
      'conv-new',
      'already-completed',
    );

    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toBeUndefined();
  });

  it('bulk clear removes unknown ghosts but keeps server-confirmed active work', async () => {
    useTaskHubStore.setState({
      pendingDispatches: {
        'mario:conv-new': [
          {
            idempotencyKey: 'unknown-ghost',
            persistenceStatus: 'failed',
            prompt: 'No server item',
            conversationId: 'conv-new',
            queuedAt: '2026-05-17T00:00:30.000Z',
          },
          {
            idempotencyKey: 'active-remotely',
            persistenceStatus: 'failed',
            prompt: 'May be active',
            conversationId: 'conv-new',
            queuedAt: '2026-05-17T00:00:31.000Z',
          },
        ],
      },
    });
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { cancelled: 0, status: 'missing' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{
          id: 'inbox-active',
          projectAgentId: 'mario',
          idempotencyKey: 'active-remotely',
          command: { source: 'system', prompt: 'May be active' },
          createdAt: '2026-05-17T00:00:31.000Z',
        }],
      } as Response);

    await useTaskHubStore.getState().clearPendingDispatches('mario', 'conv-new');

    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toEqual([
      expect.objectContaining({
        idempotencyKey: 'active-remotely',
        inboxItemId: 'inbox-active',
        persistenceStatus: 'persisted',
      }),
    ]);
  });

  it('preserves the legacy proposal marker while an agent is busy', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);
    useTaskHubStore.setState({ agentStatus: { mario: 'busy' } });

    const accepted = await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      prompt: 'stale legacy proposal',
      conversationId: 'conv-new',
      legacyProposal: true,
    });

    expect(accepted).toBe(true);
    expect(useTaskHubStore.getState().pendingDispatches['mario:conv-new']).toContainEqual(
      expect.objectContaining({
        prompt: 'stale legacy proposal',
        conversationId: 'conv-new',
        legacyProposal: true,
      }),
    );
    const enqueueCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls
      .find(([, init]) => String(init?.body).includes('dispatch.enqueue'));
    expect(JSON.parse(String(enqueueCall?.[1]?.body))).toMatchObject({
      payload: { legacyProposal: true },
    });
  });
});
