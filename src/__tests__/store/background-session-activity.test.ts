import { beforeEach, describe, expect, it } from 'vitest';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function emitProjectView(kind: string, payload: Record<string, unknown>) {
  emitServerEvent('project:view', {
    version: 1,
    projectId: 'conv-bg',
    occurredAt: '2026-05-17T00:00:00.000Z',
    kind,
    agentId: 'mario',
    payload,
  });
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
  });
}

describe('background session activity', () => {
  beforeEach(() => {
    resetBackgroundSessionStore();
  });

  it('marks an agent as background when the runtime reports child-agent activity', () => {
    emitProjectView('runtime.activity', {
      taskId: 'task-bg',
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

  it('does not clear the run or auto-advance review when the parent process exits while children are pending', () => {
    emitProjectView('runtime.activity', {
      taskId: 'task-bg',
      status: 'awaiting_children',
      reason: 'tool:Task',
    });

    emitProjectView('terminal.exited', {
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

  it('keeps a successful foreground run display-only and leaves evidence handling to the server', () => {
    emitProjectView('terminal.exited', {
      code: 0,
      command: 'opencode',
    });

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('task-bg')?.status).toBe('in_progress');
    expect(state.blockersByConversation['conv-bg']).toBeUndefined();
  });
});
