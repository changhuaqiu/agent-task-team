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
    pendingDispatches: {},
    needsFullCompose: {},
  });
}

describe('review gate wakeup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetReviewGateStore();
  });

  it('dispatches coordinator review confirmation without joining an existing A2A chain', () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitServerEvent('task.wakeup', {
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

    expect(emitSpy).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      conversationId: 'conv-review',
      projectId: 'conv-review',
      taskId: 'TASK-001',
      agentId: 'mario',
      dispatchSource: 'review_gate',
      chainId: undefined,
      passId: undefined,
    }));
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review']).toContainEqual(expect.objectContaining({
      id: 'msg-review-ready',
      mentions: ['mario'],
      metadata: expect.objectContaining({
        startsA2AHandoff: false,
        reasonCode: 'review_decision_ready',
      }),
    }));
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
        status: 'pending',
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

  it('dispatches agent and updates status when dependency_resolved wakeup arrives', () => {
    const emitSpy = vi.spyOn(socket, 'emit').mockImplementation(() => socket);

    emitServerEvent('task.wakeup', {
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

    expect(emitSpy).toHaveBeenCalledWith('terminal:start', expect.objectContaining({
      conversationId: 'conv-review',
      projectId: 'conv-review',
      taskId: 'TASK-007',
      agentId: 'luigi',
      dispatchSource: 'workflow',
    }));

    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-review']).toContainEqual(expect.objectContaining({
      id: 'msg-dep-resolved',
      mentions: ['luigi'],
      metadata: expect.objectContaining({
        reasonCode: 'dependency_resolved',
      }),
    }));

    const task = useTaskHubStore.getState().getTaskById('TASK-007');
    expect(task?.status).toBe('in_progress');
  });
});
