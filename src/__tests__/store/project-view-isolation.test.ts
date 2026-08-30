import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import { consumeProjectViewEvent, useTaskHubStore, type Account } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function envelope(
  projectId: string,
  type: string,
  payload?: Record<string, unknown>,
) {
  return {
    version: 2 as const,
    envelopeVersion: 1 as const,
    eventId: `event-${type}`,
    projectId,
    occurredAt: '2026-07-26T00:00:00.000Z',
    type,
    delivery: 'transient' as const,
    actor: { type: 'agent' as const, id: 'mario' },
    correlationId: 'trace-1',
    causationId: 'command-1',
    payload: payload ?? (type === 'terminal.output' ? { data: 'hello\r\n' } : { content: 'hello' }),
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
    hasApiKey: true,
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

  it('rejects empty project scope, unsupported versions and invalid actor identities', () => {
    const before = useTaskHubStore.getState();
    expect(consumeProjectViewEvent(envelope('', 'terminal.output'))).toBe(false);
    expect(consumeProjectViewEvent({
      ...envelope('project-a', 'terminal.output'),
      version: 3,
    } as never)).toBe(false);
    expect(consumeProjectViewEvent({
      ...envelope('project-a', 'terminal.output'),
      actor: { type: 'task', id: 'mario' },
    })).toBe(false);
    expect(consumeProjectViewEvent({
      ...envelope('project-a', 'terminal.output'),
      agent: null,
    } as never)).toBe(false);
    expect(consumeProjectViewEvent({
      ...envelope('project-a', 'terminal.output'),
      agent: { type: 'agent', id: 1 },
    } as never)).toBe(false);
    expect(consumeProjectViewEvent({
      ...envelope('project-a', 'terminal.output'),
      causationId: '',
    })).toBe(false);
    expect(useTaskHubStore.getState()).toBe(before);
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

  it('projects runtime warnings to status data without chat persistence or commands', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    expect(consumeProjectViewEvent(envelope(
      'project-a',
      'runtime.warning',
      { message: 'display-only warning' },
    ))).toBe(true);

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toBeUndefined();
    expect(useTaskHubStore.getState().eventsByConversation['project-a']).toContainEqual(
      expect.objectContaining({ type: 'runtime.warning' }),
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown project view kind without side effects', () => {
    const before = useTaskHubStore.getState();
    expect(consumeProjectViewEvent(envelope('project-a', 'runtime.future.kind', {}))).toBe(false);
    expect(useTaskHubStore.getState()).toBe(before);
  });

  it('requires matching project identifiers for non-runtime projections', () => {
    emitServerEvent('project:view', {
      ...envelope('project-a', 'a2a.snapshot', {
        snapshot: {
          conversationId: 'project-b',
          chainId: 'chain-mismatch',
          currentHolderIds: [],
          handoffs: [],
        },
      }),
      actor: { type: 'system', id: 'a2a-projection' },
    });
    emitServerEvent('project:view', {
      ...envelope('project-a', 'dispatch.receipt', {
        projectId: 'project-a',
        conversationId: 'project-b',
        receiptId: 'receipt-mismatch',
        targetAgentId: 'mario',
        phase: 'acknowledged',
        createdAt: '2026-07-26T00:00:00.000Z',
      }),
      actor: { type: 'runtime', id: 'daemon:local' },
    });

    const state = useTaskHubStore.getState();
    expect(state.a2aByConversation['project-a']).toBeUndefined();
    expect(state.dispatchReceiptsByConversation['project-b']).toBeUndefined();
  });

  it('renders a matching A2A snapshot without emitting a command or writing an API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitServerEvent('project:view', {
      ...envelope('project-a', 'a2a.snapshot', {
        snapshot: {
          conversationId: 'project-a',
          chainId: 'chain-a',
          revision: 1,
          currentHolderIds: ['mario'],
          status: 'active',
          updatedAt: '2026-07-26T00:00:00.000Z',
          handoffs: [],
        },
      }),
      actor: { type: 'system', id: 'a2a-projection' },
    });

    expect(useTaskHubStore.getState().a2aByConversation['project-a'])
      .toMatchObject({ chainId: 'chain-a', currentHolderIds: ['mario'] });
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

  it('scopes task.sync updates by project when task ids collide', () => {
    const unchangedAt = '2026-07-26T00:00:00.000Z';
    useTaskHubStore.setState({
      tasks: [
        {
          id: 'TASK-001', conversationId: 'project-a', phaseId: '', title: 'A task',
          description: '', status: 'ready', agentId: '', dependencies: [], artifacts: [],
          createdAt: unchangedAt, updatedAt: unchangedAt,
        },
        {
          id: 'TASK-001', conversationId: 'project-b', phaseId: '', title: 'B task',
          description: '', status: 'ready', agentId: '', dependencies: [], artifacts: [],
          createdAt: unchangedAt, updatedAt: unchangedAt,
        },
      ],
    });

    emitServerEvent('project:view', {
      ...envelope('project-a', 'task.sync', {
        conversationId: 'project-a',
        projectPath: 'C:/project-a',
        tasks: [{
          id: 'TASK-001', title: 'A task updated', deliverable: 'A only',
          status: 'done', agent: 'mario', depends: [],
        }],
        blockers: [],
      }),
      actor: { type: 'system', id: 'task-file-projection' },
    });

    const state = useTaskHubStore.getState();
    expect(state.tasks.find((task) => task.conversationId === 'project-a')).toMatchObject({
      title: 'A task updated', description: 'A only', status: 'done', agentId: 'mario',
    });
    expect(state.tasks.find((task) => task.conversationId === 'project-b')).toMatchObject({
      title: 'B task', description: '', status: 'ready', agentId: '', updatedAt: unchangedAt,
    });
  });

  it('rejects invalid task socket statuses without mutating tasks', () => {
    const before = useTaskHubStore.getState().tasks;

    for (const status of ['pending', '', null, undefined]) {
      emitServerEvent('project:view', {
        ...envelope('project-a', 'task.state', {
          task: {
          id: 'TASK-BAD-STATE',
          conversation_id: 'project-a',
          status,
          },
        }),
        actor: { type: 'system', id: 'task-authority' },
      });

      expect(useTaskHubStore.getState().tasks).toBe(before);
      expect(useTaskHubStore.getState().taskSyncError?.message).toContain('task.state');
    }

    emitServerEvent('project:view', {
      ...envelope('project-a', 'task.sync', {
        conversationId: 'project-a',
        projectPath: 'C:/project-a',
        tasks: [{ id: 'TASK-BAD-SYNC', title: 'Bad', status: 'rejected' }],
        blockers: [],
      }),
      actor: { type: 'system', id: 'task-file-projection' },
    });

    expect(useTaskHubStore.getState().tasks).toBe(before);
    expect(useTaskHubStore.getState().taskSyncError?.message).toContain('task.sync');
  });
});
