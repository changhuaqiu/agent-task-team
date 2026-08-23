import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore, type Account } from '@/store/taskHubStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

let projectedEventSequence = 0;

function emitProjectView(type: string, payload: Record<string, unknown>): void {
  projectedEventSequence += 1;
  const agentId = typeof payload.agentId === 'string' ? payload.agentId : undefined;
  emitServerEvent('project:view', {
    version: 2,
    envelopeVersion: 1,
    eventId: `review-event-${projectedEventSequence}`,
    projectId: 'conv-review',
    occurredAt: '2026-05-17T00:00:00.000Z',
    type,
    delivery: 'durable',
    actor: agentId
      ? { type: 'agent', id: agentId }
      : { type: 'system', id: 'review-gate' },
    correlationId: typeof payload.taskId === 'string' ? payload.taskId : 'conv-review',
    causationId: typeof payload.taskId === 'string' ? payload.taskId : 'conv-review',
    payload,
  });
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
    createdAt: '2026-05-17T00:00:00.000Z',
    updatedAt: '2026-05-17T00:00:00.000Z',
  };
}

function resetReviewGateStore() {
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-review',
      title: 'Review gate',
      goal: 'Return review decisions to coordinator',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-review',
    selectedProjectId: 'conv-review',
    activeAgentIds: ['mario', 'dk'],
    currentTeamPack: null,
    roleCards: [...PRESET_ROLE_CARDS],
    accounts: [account('acc-openai')],
    agentAccountOverrides: { mario: ['acc-openai'] },
    agentRoleCardOverrides: {},
    agentSkillIds: {},
    skillsMap: {},
    tasks: [{
      id: 'TASK-001',
      conversationId: 'conv-review',
      phaseId: '',
      title: 'Harness review',
      description: 'Confirm DK review result.',
      status: 'in_review',
      agentId: 'dk',
      dependencies: [],
      artifacts: [],
      reviewNote: 'PASS: DK review approved',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    chatMessagesByConversation: {},
    eventsByConversation: {},
    agentStatus: {},
    terminalLogs: {},
    activeRunsByAgent: {},
    agentSessions: { 'conv-review': {} },
    needsFullCompose: {},
  });
}

describe('review gate wakeup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    resetReviewGateStore();
  });

  it('renders coordinator review confirmation without browser dispatch', async () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitProjectView('task.wakeup', {
      projectId: 'conv-review',
      id: 'msg-review-ready',
      conversationId: 'conv-review',
      taskId: 'TASK-001',
      agentId: 'mario',
      reasonCode: 'review_decision_ready',
      dispatchSource: 'review_gate',
      prompt: '请确认 TASK-001 的 DK 评审结论。',
      content: '系统轻推 @mario：TASK-001「Harness review」请确认评审结论。',
      metadata: {
        startsA2AHandoff: false,
        startsDispatch: true,
      },
    });

    await Promise.resolve();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review']).toContainEqual(expect.objectContaining({
      id: 'msg-review-ready',
      mentions: ['mario'],
      metadata: expect.objectContaining({
        startsA2AHandoff: false,
        reasonCode: 'review_decision_ready',
      }),
    }));
  });

  it('renders a QA wakeup without browser dispatch', async () => {
    useTaskHubStore.setState((state) => ({
      activeAgentIds: ['mario', 'dk', 'peach'],
      agentAccountOverrides: {
        ...state.agentAccountOverrides,
        peach: ['acc-openai'],
      },
    }));
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitProjectView('task.wakeup', {
      projectId: 'conv-review',
      id: 'msg-test-ready',
      conversationId: 'conv-review',
      taskId: 'TASK-001',
      agentId: 'peach',
      reasonCode: 'test_requested',
      dispatchSource: 'test_gate',
      prompt: '请开始测试 TASK-001: Harness review.',
      content: '系统轻推 @yoshi：TASK-001「Harness review」请开始测试。',
      metadata: {
        startsA2AHandoff: false,
        startsDispatch: true,
      },
    });

    await Promise.resolve();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
  });

  it('records dispatch receipts from the daemon', () => {
    emitProjectView('dispatch.receipt', {
      projectId: 'conv-review',
      receiptId: 'env-1:acknowledged',
      conversationId: 'conv-review',
      taskId: 'TASK-001',
      targetAgentId: 'mario',
      source: 'review_gate',
      phase: 'acknowledged',
      createdAt: '2026-05-17T00:01:00.000Z',
    });

    expect(useTaskHubStore.getState().dispatchReceiptsByConversation['conv-review']).toContainEqual(expect.objectContaining({
      receiptId: 'env-1:acknowledged',
      phase: 'acknowledged',
      targetAgentId: 'mario',
    }));
  });

  it('renders a server-owned wakeup without dispatching it again in the browser', async () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitProjectView('task.wakeup', {
      projectId: 'conv-review',
      id: 'msg-server-owned',
      conversationId: 'conv-review',
      taskId: 'TASK-001',
      agentId: 'mario',
      reasonCode: 'review_decision_ready',
      dispatchSource: 'review_gate',
      prompt: 'Confirm review',
      content: 'Server-owned wakeup',
    });

    await Promise.resolve();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review'])
      .toContainEqual(expect.objectContaining({ id: 'msg-server-owned' }));
  });

  it('does not execute work when an A2A projection is received', async () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitProjectView('a2a.snapshot', {
      snapshot: {
          conversationId: 'conv-review',
          chainId: 'chain-1',
          revision: 1,
          currentHolderIds: ['mario'],
          status: 'active',
          updatedAt: '2026-07-28T00:00:00.000Z',
          handoffs: [],
      },
    });

    await Promise.resolve();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    expect(emitSpy).not.toHaveBeenCalledWith('a2a:agent-started', expect.anything());
  });

  it('does not re-dispatch the implementer from a successful exit projection', async () => {
    vi.useFakeTimers();
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);
    useTaskHubStore.setState((state) => ({
      activeRunsByAgent: {
        ...state.activeRunsByAgent,
        mario: {
          runId: 'run-1',
          taskId: 'TASK-001',
          conversationId: 'conv-review',
          startedAt: '2026-05-17T00:00:00.000Z',
          activity: 'foreground',
        },
      },
      tasks: state.tasks.map((task) => task.id === 'TASK-001' ? { ...task, status: 'in_progress', agentId: 'mario' } : task),
    }));

    emitProjectView('terminal.exited', {
      agentId: 'mario',
        code: 0,
        command: 'opencode',
        activity: 'idle',
    });

    await vi.advanceTimersByTimeAsync(350);

    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());
    vi.useRealTimers();
  });
});

describe('dependency_resolved wakeup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetReviewGateStore();
    useTaskHubStore.setState((state) => ({
      tasks: [...state.tasks, {
        id: 'TASK-007',
        conversationId: 'conv-review',
        phaseId: '',
        title: 'Integration wiring',
        description: 'Wire socket listeners to UI components',
        status: 'ready',
        agentId: 'luigi',
        dependencies: ['TASK-004', 'TASK-006'],
        artifacts: [],
        reviewNote: null,
        createdAt: '2026-05-17T00:00:00.000Z',
        updatedAt: '2026-05-17T00:00:00.000Z',
      }],
      activeAgentIds: ['mario', 'dk', 'luigi'],
      agentAccountOverrides: {
        mario: ['acc-openai'],
        luigi: ['acc-openai'],
      },
    }));
  });

  it('renders dependency_resolved without dispatching or changing domain state', async () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitProjectView('task.wakeup', {
      projectId: 'conv-review',
      id: 'msg-dep-resolved',
      conversationId: 'conv-review',
      taskId: 'TASK-007',
      agentId: 'luigi',
      reasonCode: 'dependency_resolved',
      dispatchSource: 'workflow',
      prompt: '依赖已满足，开始执行 TASK-007: Integration wiring',
      content: '系统轻推 @luigi：TASK-007「Integration wiring」请继续处理。',
      metadata: {
        startsA2AHandoff: false,
        startsDispatch: true,
      },
    });

    await Promise.resolve();
    expect(emitSpy).not.toHaveBeenCalledWith('terminal:start', expect.anything());

    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review']).toContainEqual(expect.objectContaining({
      id: 'msg-dep-resolved',
      mentions: ['luigi'],
      metadata: expect.objectContaining({
        reasonCode: 'dependency_resolved',
      }),
    }));

    const task = useTaskHubStore.getState().getTaskById('TASK-007');
    expect(task?.status).toBe('ready');
  });
});
