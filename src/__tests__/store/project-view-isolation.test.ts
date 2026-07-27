import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import { consumeProjectViewEvent, useTaskHubStore, type Account } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function envelope(projectId: string, kind: 'terminal.output' | 'runtime.text.delta') {
  return {
    version: 1 as const,
    projectId,
    occurredAt: '2026-07-26T00:00:00.000Z',
    kind,
    agentId: 'mario',
    payload: kind === 'terminal.output' ? { data: 'hello\r\n' } : { content: 'hello' },
  };
}

function resetStore() {
  const account: Account = {
    id: 'account-1',
    name: 'Account',
    authMode: 'api_key',
    provider: 'openai',
    models: ['gpt-5.4'],
    enabled: true,
    status: 'valid',
    createdAt: '2026-07-26T00:00:00.000Z',
    updatedAt: '2026-07-26T00:00:00.000Z',
  };
  useTaskHubStore.setState({
    conversations: [
      {
        id: 'project-a',
        title: 'A',
        goal: '',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
      {
        id: 'project-b',
        title: 'B',
        goal: '',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      },
    ],
    selectedConversationId: 'project-a',
    selectedProjectId: 'project-a',
    activeAgentIds: ['mario'],
    roleCards: [...PRESET_ROLE_CARDS],
    accounts: [account],
    agentAccountOverrides: { mario: [account.id] },
    agentRoleCardOverrides: {},
    agentSkillIds: {},
    skillsMap: {},
    terminalLogs: {},
    agentStatus: {},
    activeRunsByAgent: {},
    activeStreamMessageId: {},
    activeStreamConversationId: {},
    chatMessagesByConversation: {},
    eventsByConversation: {},
  });
}

describe('project view isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    resetStore();
  });

  it('ignores an otherwise valid event from a different project', () => {
    expect(consumeProjectViewEvent(envelope('project-b', 'terminal.output'))).toBe(false);
    expect(useTaskHubStore.getState().terminalLogs).toEqual({});
  });

  it('applies an event from the selected project', () => {
    expect(consumeProjectViewEvent(envelope('project-a', 'terminal.output'))).toBe(true);
    expect(useTaskHubStore.getState().terminalLogs.mario).toEqual(['hello\r\n']);
  });

  it('makes direct ACP text visible in both chat and terminal projections', () => {
    expect(consumeProjectViewEvent(envelope('project-a', 'runtime.text.delta'))).toBe(true);

    const state = useTaskHubStore.getState();
    expect(state.terminalLogs.mario).toEqual(['hello']);
    expect(state.chatMessagesByConversation['project-a']).toContainEqual(expect.objectContaining({
      agentId: 'mario',
      content: 'hello',
    }));
  });

  it('renders runtime warnings without persisting or emitting a command', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    expect(consumeProjectViewEvent({
      version: 1,
      projectId: 'project-a',
      occurredAt: '2026-07-26T00:00:00.000Z',
      kind: 'runtime.warning',
      agentId: 'mario',
      payload: { message: 'display-only warning' },
    })).toBe(true);

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toContainEqual(
      expect.objectContaining({ agentId: 'mario', content: '⚠️ display-only warning' }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown project view kind without side effects', () => {
    const before = useTaskHubStore.getState();
    expect(consumeProjectViewEvent({
      version: 1,
      projectId: 'project-a',
      occurredAt: '2026-07-26T00:00:00.000Z',
      kind: 'runtime.future.kind',
      agentId: 'mario',
      payload: {},
    })).toBe(false);
    expect(useTaskHubStore.getState()).toBe(before);
  });

  it('requires matching project identifiers for non-runtime projections', () => {
    emitServerEvent('a2a:notice', {
      projectId: 'project-a',
      conversationId: 'project-b',
      kind: 'dispatch.blocked',
      content: 'must stay invisible',
    });
    emitServerEvent('dispatch.receipt', {
      projectId: 'project-a',
      conversationId: 'project-b',
      receiptId: 'receipt-mismatch',
      targetAgentId: 'mario',
      phase: 'acknowledged',
      createdAt: '2026-07-26T00:00:00.000Z',
    });

    const state = useTaskHubStore.getState();
    expect(state.chatMessagesByConversation['project-a']).toBeUndefined();
    expect(state.dispatchReceiptsByConversation['project-b']).toBeUndefined();
  });

  it('renders a matching A2A notice without emitting a command or writing an API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitServerEvent('a2a:notice', {
      projectId: 'project-a',
      conversationId: 'project-a',
      kind: 'dispatch.blocked',
      content: 'display-only A2A notice',
    });

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a'])
      .toContainEqual(expect.objectContaining({
        agentId: 'system',
        content: 'display-only A2A notice',
      }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('clears transient runtime projections when the selected project changes', () => {
    vi.spyOn(socket, 'emit').mockImplementation(() => socket);
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    useTaskHubStore.setState({
      terminalLogs: { mario: ['project-a output'] },
      agentStatus: { mario: 'busy' },
      activeRunsByAgent: {
        mario: {
          runId: 'run-a',
          conversationId: 'project-a',
          startedAt: '2026-07-26T00:00:00.000Z',
        },
      },
      activeStreamMessageId: { mario: 'message-a' },
      activeStreamConversationId: { mario: 'project-a' },
    });

    useTaskHubStore.getState().setSelectedConversationId('project-b');

    expect(useTaskHubStore.getState()).toMatchObject({
      selectedConversationId: 'project-b',
      terminalLogs: {},
      agentStatus: {},
      activeRunsByAgent: {},
      activeStreamMessageId: {},
      activeStreamConversationId: {},
    });
  });

  it('keeps explicit human commands available', async () => {
    const emit = vi.spyOn(socket, 'emit').mockImplementation(() => socket);
    const accepted = await useTaskHubStore.getState().dispatchToAgent({
      agentId: 'mario',
      conversationId: 'project-a',
      prompt: 'human typed command',
      source: 'user',
    });

    expect(accepted).toBe(true);
    expect(emit).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      projectId: 'project-a',
      conversationId: 'project-a',
      prompt: 'human typed command',
      dispatchSource: 'user',
    }));
  });
  it('scopes task.sync updates by project when task ids collide', () => {
    const unchangedAt = '2026-07-26T00:00:00.000Z';
    useTaskHubStore.setState({
      tasks: [
        {
          id: 'TASK-001', conversationId: 'project-a', phaseId: '', title: 'A task',
          description: '', status: 'pending', agentId: '', dependencies: [], artifacts: [],
          createdAt: unchangedAt, updatedAt: unchangedAt,
        },
        {
          id: 'TASK-001', conversationId: 'project-b', phaseId: '', title: 'B task',
          description: '', status: 'pending', agentId: '', dependencies: [], artifacts: [],
          createdAt: unchangedAt, updatedAt: unchangedAt,
        },
      ],
    });

    emitServerEvent('task.sync', {
      projectId: 'project-a',
      conversationId: 'project-a',
      projectPath: 'C:/project-a',
      tasks: [{
        id: 'TASK-001', title: 'A task updated', deliverable: 'A only',
        status: 'done', agent: 'mario', depends: [],
      }],
      blockers: [],
    });

    const state = useTaskHubStore.getState();
    expect(state.tasks.find((task) => task.conversationId === 'project-a')).toMatchObject({
      title: 'A task updated', description: 'A only', status: 'done', agentId: 'mario',
    });
    expect(state.tasks.find((task) => task.conversationId === 'project-b')).toMatchObject({
      title: 'B task', description: '', status: 'pending', agentId: '', updatedAt: unchangedAt,
    });
  });
});
