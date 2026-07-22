import { beforeEach, describe, expect, it } from 'vitest';
import { agentRuntimeKey, socket } from '@/store/daemonStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function resetBackgroundSessionStore() {
  const scopeKey = agentRuntimeKey('conv-bg', 'mario');
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
    agentStatus: { [scopeKey]: 'busy' },
    terminalLogs: {},
    activeRunsByAgent: {
      [scopeKey]: {
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
    const scopeKey = agentRuntimeKey('conv-bg', 'mario');
    expect(state.agentStatus[scopeKey]).toBe('background');
    expect(state.activeRunsByAgent[scopeKey]).toMatchObject({
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
    const scopeKey = agentRuntimeKey('conv-bg', 'mario');
    expect(state.agentStatus[scopeKey]).toBe('background');
    expect(state.activeRunsByAgent[scopeKey]?.activity).toBe('awaiting_children');
    expect(state.getTaskById('task-bg')?.status).toBe('in_progress');
    expect(state.eventsByConversation['conv-bg'].some((event) => event.type === 'run.finished')).toBe(false);
  });

  it('keeps terminal exit as a runtime projection without mutating task facts', () => {
    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      agentId: 'mario',
      taskId: 'task-bg',
      invocationId: 'run-bg',
      code: 0,
      command: 'opencode',
    });

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('task-bg')?.status).toBe('in_progress');
    expect(state.blockersByConversation['conv-bg'] ?? []).toEqual([]);
  });

  it('rebinds a reused agent to the running invocation and ignores stale exits', () => {
    const baseTask = useTaskHubStore.getState().getTaskById('task-bg')!;
    useTaskHubStore.setState((state) => ({
      tasks: [
        { ...baseTask, id: 'task-old', status: 'done' },
        { ...baseTask, id: 'task-new', status: 'in_progress' },
      ],
      activeRunsByAgent: {
        ...state.activeRunsByAgent,
        [agentRuntimeKey('conv-bg', 'mario')]: {
          runId: 'inv-old',
          taskId: 'task-old',
          conversationId: 'conv-bg',
          startedAt: '2026-05-17T00:00:00.000Z',
          activity: 'foreground',
        },
      },
    }));

    emitServerEvent('agent:activity', {
      conversationId: 'conv-bg',
      taskId: 'task-new',
      invocationId: 'inv-new',
      agentId: 'mario',
      status: 'running',
    });

    const scopeKey = agentRuntimeKey('conv-bg', 'mario');
    expect(useTaskHubStore.getState().activeRunsByAgent[scopeKey]).toMatchObject({
      runId: 'inv-new',
      taskId: 'task-new',
      activity: 'foreground',
    });

    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      taskId: 'task-old',
      invocationId: 'inv-old',
      agentId: 'mario',
      code: 1,
      reasonCode: 'acp_timeout',
    });

    let state = useTaskHubStore.getState();
    expect(state.activeRunsByAgent[scopeKey]?.runId).toBe('inv-new');
    expect(state.getTaskById('task-old')?.status).toBe('done');
    expect(state.getTaskById('task-new')?.status).toBe('in_progress');

    emitServerEvent('terminal:exit', {
      conversationId: 'conv-bg',
      taskId: 'task-new',
      invocationId: 'inv-new',
      agentId: 'mario',
      code: 1,
      reasonCode: 'acp_timeout',
    });

    state = useTaskHubStore.getState();
    expect(state.activeRunsByAgent[scopeKey]).toBeUndefined();
    expect(state.getTaskById('task-old')?.status).toBe('done');
    expect(state.getTaskById('task-new')?.status).toBe('in_progress');
    expect(state.eventsByConversation['conv-bg']).toContainEqual(expect.objectContaining({
      type: 'run.finished',
      payload: expect.objectContaining({ runId: 'inv-new', taskId: 'task-new', code: 1 }),
    }));
  });
});
