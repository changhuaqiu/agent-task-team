import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentRuntimeKey, socket } from '@/store/daemonStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function resetRuntimeScopeStore() {
  const oldKey = agentRuntimeKey('conv-old', 'mario');
  const newKey = agentRuntimeKey('conv-new', 'mario');
  useTaskHubStore.setState({
    conversations: [
      {
        id: 'conv-old', title: 'Old', goal: 'Old goal', status: 'active', priority: 'p1',
        projectPath: 'C:/old', breakdownStatus: 'none', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      },
      {
        id: 'conv-new', title: 'New', goal: 'New goal', status: 'active', priority: 'p1',
        projectPath: 'C:/new', breakdownStatus: 'none', createdAt: '2026-07-22T00:00:00.000Z', updatedAt: '2026-07-22T00:00:00.000Z',
      },
    ],
    selectedConversationId: 'conv-new',
    selectedProjectId: 'conv-new',
    tasks: [],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    blockersByConversation: {},
    terminalLogs: {},
    agentStatus: { [oldKey]: 'busy', [newKey]: 'busy' },
    activeRunsByAgent: {
      [oldKey]: { runId: 'run-old', conversationId: 'conv-old', startedAt: '2026-07-22T00:00:00.000Z' },
      [newKey]: { runId: 'run-new', conversationId: 'conv-new', startedAt: '2026-07-22T00:00:01.000Z' },
    },
    activeStreamMessageId: {},
    activeStreamConversationId: {},
    pendingDispatches: {},
  });
}

describe('conversation-scoped runtime UI state', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    resetRuntimeScopeStore();
  });

  it('keeps same-agent streams, tool traces, and completion isolated by conversation', () => {
    emitServerEvent('agent:event', {
      conversationId: 'conv-old', agentId: 'mario', invocationId: 'inv-old', type: 'text', content: 'OLD OUTPUT',
    });
    emitServerEvent('agent:event', {
      conversationId: 'conv-old', agentId: 'mario', invocationId: 'inv-old', type: 'tool_use',
      tool: { name: 'Read File', input: 'C:/old/package.json' },
    });
    emitServerEvent('agent:event', {
      conversationId: 'conv-new', agentId: 'mario', invocationId: 'inv-new', type: 'text', content: 'NEW OUTPUT',
    });

    let state = useTaskHubStore.getState();
    const oldMessage = state.chatMessagesByConversation['conv-old'][0];
    const newMessage = state.chatMessagesByConversation['conv-new'][0];
    expect(oldMessage.content).toBe('OLD OUTPUT');
    expect(oldMessage.toolEvents).toContainEqual(expect.objectContaining({ detail: 'C:/old/package.json' }));
    expect(newMessage.content).toBe('NEW OUTPUT');
    expect(newMessage.toolEvents).toEqual([]);
    expect(oldMessage.id).not.toBe(newMessage.id);

    emitServerEvent('agent:event', {
      conversationId: 'conv-old', agentId: 'mario', invocationId: 'inv-old', type: 'done', content: '',
    });

    state = useTaskHubStore.getState();
    expect(state.chatMessagesByConversation['conv-old'][0].isStreaming).toBe(false);
    expect(state.chatMessagesByConversation['conv-new'][0].isStreaming).toBe(true);
    expect(state.activeStreamMessageId[agentRuntimeKey('conv-old', 'mario')]).toBeUndefined();
    expect(state.activeStreamMessageId[agentRuntimeKey('conv-new', 'mario')]).toBe(newMessage.id);
  });

  it('does not let activity, exit, or terminal output overwrite the other project', () => {
    const oldKey = agentRuntimeKey('conv-old', 'mario');
    const newKey = agentRuntimeKey('conv-new', 'mario');

    emitServerEvent('agent:activity', {
      conversationId: 'conv-old', agentId: 'mario', status: 'awaiting_children', reason: 'tool:Task',
    });
    emitServerEvent('terminal:data', {
      conversationId: 'conv-old', agentId: 'mario', data: 'OLD TERMINAL',
    });

    let state = useTaskHubStore.getState();
    expect(state.agentStatus[oldKey]).toBe('background');
    expect(state.agentStatus[newKey]).toBe('busy');
    expect(state.terminalLogs[oldKey]).toEqual(['OLD TERMINAL']);
    expect(state.terminalLogs[newKey]).toBeUndefined();

    emitServerEvent('agent:activity', {
      conversationId: 'conv-old', agentId: 'mario', status: 'idle',
    });

    state = useTaskHubStore.getState();
    expect(state.agentStatus[oldKey]).toBe('idle');
    expect(state.activeRunsByAgent[oldKey]).toBeUndefined();
    expect(state.agentStatus[newKey]).toBe('busy');
    expect(state.activeRunsByAgent[newKey]).toMatchObject({ runId: 'run-new', conversationId: 'conv-new' });
  });
});
