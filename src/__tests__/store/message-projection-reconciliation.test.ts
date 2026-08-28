import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import {
  consumeProjectViewEvent,
  mapMessagesToState,
  reconcileConversationMessages,
  useTaskHubStore,
  type Account,
  type ChatMessage,
} from '@/store/taskHubStore';

const timestamp = '2026-07-26T00:00:00.000Z';

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    agentId: 'mario',
    timestamp,
    conversationId: 'project-a',
    ...input,
  };
}

function persistedEnvelope() {
  return {
    version: 2 as const,
    envelopeVersion: 1 as const,
    eventId: 'event-message-persisted',
    projectId: 'project-a',
    occurredAt: timestamp,
    type: 'chat.message.persisted' as const,
    delivery: 'durable' as const,
    actor: { type: 'agent', id: 'mario' },
    subject: { type: 'invocation', id: 'inv-1' },
    correlationId: 'inv-1',
    causationId: 'runtime-event-1',
    payload: {
      message: {
        id: 'msg-durable',
        conversation_id: 'project-a',
        task_id: null,
        sender_type: 'agent',
        sender_id: 'mario',
        content: 'complete answer',
        content_type: 'text',
        mentions: null,
        intent: null,
        metadata: JSON.stringify({ sourceEventId: 'event-1' }),
        visibility: 'public',
        invocation_id: 'inv-1',
        created_at: timestamp,
      },
    },
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
    createdAt: timestamp,
    updatedAt: timestamp,
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
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: 'project-b',
        title: 'B',
        goal: '',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: timestamp,
        updatedAt: timestamp,
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
    messageHistoryByConversation: {},
    eventsByConversation: {},
  });
}

describe('durable message reconciliation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    resetStore();
  });

  it('keeps an active stream during hydration, then replaces its provisional row after completion', () => {
    const provisional = message({
      id: 'stream-1',
      content: 'partial answer',
      invocationId: 'inv-1',
      isStreaming: true,
    });
    const durable = message({
      id: 'msg-durable',
      content: 'complete answer',
      invocationId: 'inv-1',
      metadata: { sourceEventId: 'event-1' },
    });

    expect(reconcileConversationMessages(
      [provisional],
      [durable],
      new Set(['stream-1']),
    )).toEqual(expect.arrayContaining([provisional, durable]));
    expect(reconcileConversationMessages([provisional], [durable])).toEqual([durable]);
  });

  it('deduplicates an optimistic human message against its durable copy', () => {
    const optimistic = message({ id: 'optimistic', agentId: 'human', content: 'hello' });
    const durable = message({
      id: 'msg-human',
      agentId: 'human',
      content: 'hello',
      timestamp: '2026-07-26T00:00:05.000Z',
    });
    expect(reconcileConversationMessages([optimistic], [durable])).toEqual([durable]);
  });

  it('does not consume a newer identical optimistic message with an already matched durable row', () => {
    const durable = message({
      id: 'msg-old',
      agentId: 'human',
      content: 'ok',
    });
    const newerOptimistic = message({
      id: 'optimistic-new',
      agentId: 'human',
      content: 'ok',
      timestamp: '2026-07-26T00:00:01.000Z',
    });

    expect(reconcileConversationMessages(
      [durable, newerOptimistic],
      [durable],
    )).toEqual([durable, newerOptimistic]);
  });

  it('preserves multiple durable rows produced by one invocation', () => {
    const first = message({
      id: 'msg-0001785080896783-000005-c9556c7f',
      content: 'first segment',
      invocationId: 'inv-1',
      metadata: { sourceEventId: 'event-1' },
    });
    const second = message({
      id: 'msg-0001785080896784-000006-d0667d80',
      content: 'second segment',
      invocationId: 'inv-1',
      metadata: { sourceEventId: 'event-2' },
    });

    expect(reconcileConversationMessages([first], [second])).toEqual(
      expect.arrayContaining([first, second]),
    );
  });

  it('maps a persisted tool row identically alone or inside a full snapshot', () => {
    const textRow = {
      ...persistedEnvelope().payload.message,
      id: 'msg-text',
      content: 'before tool',
    };
    const toolRow = {
      ...persistedEnvelope().payload.message,
      id: 'msg-tool',
      content: 'use shell',
      content_type: 'tool_use',
      metadata: JSON.stringify({
        sourceEventId: 'event-tool',
        toolEvent: { name: 'Shell', input: 'pwd' },
      }),
    };

    const alone = mapMessagesToState({ 'project-a': [toolRow] })['project-a'][0];
    const inSnapshot = mapMessagesToState({
      'project-a': [textRow, toolRow],
    })['project-a'][1];

    expect(alone).toEqual(inSnapshot);
    expect(alone).toMatchObject({
      id: 'msg-tool',
      content: '',
      toolEvents: [expect.objectContaining({ id: 'msg-tool', label: 'Shell' })],
    });
    expect(reconcileConversationMessages([alone], [inSnapshot])).toEqual([inSnapshot]);
  });

  it('keeps a persisted thinking segment distinct from the final answer', () => {
    const thinkingRow = {
      ...persistedEnvelope().payload.message,
      id: 'msg-thinking',
      content: '先理解任务边界。',
      content_type: 'thinking',
    };

    expect(mapMessagesToState({ 'project-a': [thinkingRow] })['project-a'][0]).toMatchObject({
      content: '先理解任务边界。',
      contentType: 'thinking',
      invocationId: 'inv-1',
    });
  });

  it('projects live thinking deltas into the active Agent response', () => {
    expect(consumeProjectViewEvent({
      version: 2,
      envelopeVersion: 1,
      eventId: 'event-thinking-delta',
      projectId: 'project-a',
      occurredAt: timestamp,
      type: 'runtime.thinking.delta',
      delivery: 'transient',
      actor: { type: 'runtime', id: 'local-daemon' },
      agent: { type: 'agent', id: 'mario' },
      subject: { type: 'invocation', id: 'inv-1' },
      correlationId: 'inv-1',
      causationId: 'runtime-event-1',
      payload: { content: '正在分析。', invocationId: 'inv-1' },
    })).toBe(true);

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toEqual([
      expect.objectContaining({
        agentId: 'mario',
        thinking: '正在分析。',
        content: '',
        isStreaming: true,
      }),
    ]);
  });

  it('reconciles a post-persistence notification without duplicating the completed stream', () => {
    useTaskHubStore.setState({
      chatMessagesByConversation: {
        'project-a': [message({
          id: 'stream-1',
          content: 'partial answer',
          invocationId: 'inv-1',
          isStreaming: true,
        })],
      },
      activeStreamMessageId: { mario: 'stream-1' },
      activeStreamConversationId: { mario: 'project-a' },
    });

    expect(consumeProjectViewEvent(persistedEnvelope())).toBe(true);
    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toHaveLength(2);

    expect(consumeProjectViewEvent({
      version: 2,
      envelopeVersion: 1,
      eventId: 'event-runtime-completed',
      projectId: 'project-a',
      occurredAt: timestamp,
      type: 'runtime.completed',
      delivery: 'durable',
      actor: { type: 'agent', id: 'mario' },
      subject: { type: 'invocation', id: 'inv-1' },
      correlationId: 'inv-1',
      causationId: 'runtime-event-1',
      payload: { outcome: 'completed' },
    })).toBe(true);

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toEqual([
      expect.objectContaining({ id: 'msg-durable', content: 'complete answer' }),
    ]);
  });

  it('single-flights snapshot requests and merges the durable result', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal('fetch', fetchSpy);
    useTaskHubStore.setState({
      chatMessagesByConversation: {
        'project-a': [message({ id: 'local', content: 'local-only' })],
      },
    });

    const first = useTaskHubStore.getState().refreshConversationMessages('project-a');
    const second = useTaskHubStore.getState().refreshConversationMessages('project-a');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch({
      ok: true,
      json: async () => ({ messages: [persistedEnvelope().payload.message] }),
    } as Response);
    await Promise.all([first, second]);

    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toEqual([
      expect.objectContaining({ id: 'local' }),
      expect.objectContaining({ id: 'msg-durable' }),
    ]);
  });

  it('loads older durable pages without replacing newer or live messages', async () => {
    const older = {
      ...persistedEnvelope().payload.message,
      id: 'msg-older',
      content: 'older durable answer',
      created_at: '2026-07-25T00:00:00.000Z',
    };
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        messages: [older],
        hasMore: false,
        nextCursor: { createdAt: older.created_at, id: older.id },
      }),
    } as Response));
    vi.stubGlobal('fetch', fetchSpy);
    useTaskHubStore.setState({
      chatMessagesByConversation: {
        'project-a': [message({ id: 'msg-newer', content: 'newer live answer' })],
      },
      messageHistoryByConversation: {
        'project-a': {
          hasMore: true,
          nextCursor: { createdAt: timestamp, id: 'msg-newer' },
          isLoadingOlder: false,
        },
      },
    });

    await useTaskHubStore.getState().loadOlderConversationMessages('project-a');

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('beforeId=msg-newer');
    expect(useTaskHubStore.getState().chatMessagesByConversation['project-a']).toEqual([
      expect.objectContaining({ id: 'msg-older' }),
      expect.objectContaining({ id: 'msg-newer' }),
    ]);
    expect(useTaskHubStore.getState().messageHistoryByConversation['project-a']).toEqual({
      hasMore: false,
      nextCursor: { createdAt: older.created_at, id: older.id },
      isLoadingOlder: false,
    });
  });

  it('refreshes the selected project on project switch and socket reconnect', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/messages')) {
        return { ok: true, json: async () => ({ messages: [] }) } as Response;
      }
      return { ok: true, json: async () => [] } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    useTaskHubStore.getState().setSelectedConversationId('project-b');
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/messages?conversationId=project-b',
        { cache: 'no-store' },
      );
    });
    await useTaskHubStore.getState().refreshConversationMessages('project-b');

    fetchSpy.mockClear();
    const connectListeners = (
      socket as unknown as { listeners(event: string): Array<() => void> }
    ).listeners('connect');
    expect(connectListeners).not.toHaveLength(0);
    connectListeners.forEach((listener) => listener());
    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/messages?conversationId=project-b',
        { cache: 'no-store' },
      );
    });
  });
});
