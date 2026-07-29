import { beforeEach, describe, expect, it } from 'vitest';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function resetBackgroundSessionStore() {
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-bg',
      title: 'Background project',
      goal: 'Track opencode child agents',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-bg',
    selectedProjectId: 'conv-bg',
    tasks: [{
      id: 'task-bg',
      conversationId: 'conv-bg',
      phaseId: '',
      title: 'Investigate child agent result',
      description: 'Parent process exits before child agent returns.',
      status: 'in_progress',
      agentId: 'mario',
      dependencies: [],
      artifacts: [],
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    blockersByConversation: {},
    agentStatus: { mario: 'busy' },
    terminalLogs: {},
    activeRunsByAgent: {
      mario: {
        runId: 'run-bg',
        taskId: 'task-bg',
        conversationId: 'conv-bg',
        startedAt: '2026-05-17T00:00:00.000Z',
        activity: 'foreground',
      },
    },
    agentSessions: { 'conv-bg': { mario: 'session-bg' } },
    activeStreamMessageId: {},
    activeStreamConversationId: {},
    pendingDispatches: {},
  });
}

describe('background session activity', () => {
  beforeEach(() => {
    resetBackgroundSessionStore();
  });

  it('marks an agent as background when the runtime reports child-agent activity', () => {
    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-bg',
      agentId: 'mario',
      sessionId: 'session-bg',
      status: 'awaiting_children',
      reason: 'tool:Agent',
    });

    const state = useTaskHubStore.getState();
    expect(state.agentStatus.mario).toBe('background');
    expect(state.activeRunsByAgent.mario).toMatchObject({
      runId: 'run-bg',
      taskId: 'task-bg',
      conversationId: 'conv-bg',
      activity: 'awaiting_children',
    });
    expect(state.eventsByConversation['conv-bg']).toContainEqual(expect.objectContaining({
      type: 'run.background_waiting',
      payload: expect.objectContaining({ agentId: 'mario', reason: 'tool:Agent' }),
    }));
  });

  it('returns the parent run to foreground when the native child tool settles', () => {
    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-bg',
      agentId: 'mario',
      status: 'awaiting_children',
      reason: 'tool:Task',
    });

    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-bg',
      agentId: 'mario',
      status: 'running',
      reason: 'tool_complete:Task',
    });

    const state = useTaskHubStore.getState();
    expect(state.agentStatus.mario).toBe('busy');
    expect(state.activeRunsByAgent.mario).toMatchObject({
      runId: 'run-bg',
      taskId: 'task-bg',
      conversationId: 'conv-bg',
      activity: 'foreground',
    });
  });

  it('does not clear the run or auto-advance review when the parent process exits while children are pending', () => {
    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-bg',
      agentId: 'mario',
      status: 'awaiting_children',
      reason: 'tool:Task',
    });

    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      agentId: 'mario',
      code: 0,
      command: 'opencode',
      activity: 'awaiting_children',
    });

    const state = useTaskHubStore.getState();
    expect(state.agentStatus.mario).toBe('background');
    expect(state.activeRunsByAgent.mario?.activity).toBe('awaiting_children');
    expect(state.getTaskById('task-bg')?.status).toBe('in_progress');
    expect(state.eventsByConversation['conv-bg'].some((event) => event.type === 'run.finished')).toBe(false);
  });

  it('treats an explicit idle exit as authoritative over stale background UI state', () => {
    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-bg',
      agentId: 'mario',
      status: 'awaiting_children',
      reason: 'tool:Task',
    });

    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      agentId: 'mario',
      code: 0,
      command: 'claude',
      activity: 'idle',
    });

    const state = useTaskHubStore.getState();
    expect(state.activeRunsByAgent.mario?.activity).not.toBe('awaiting_children');
    expect(state.eventsByConversation['conv-bg']).toContainEqual(expect.objectContaining({
      type: 'run.finished',
      payload: expect.objectContaining({ agentId: 'mario', code: 0 }),
    }));
  });

  it('keeps a successful foreground run in progress until implementation evidence is supplied', () => {
    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      agentId: 'mario',
      code: 0,
      command: 'opencode',
    });

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('task-bg')?.status).toBe('in_progress');
    expect(state.blockersByConversation['conv-bg']).toContainEqual(expect.objectContaining({
      taskId: 'task-bg',
      type: 'gate_fail',
      gateId: 'build',
      reasonSummary: expect.stringContaining('installResult'),
    }));
  });
});
