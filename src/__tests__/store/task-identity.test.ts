import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore, type Task, type TaskIdentity } from '@/store/taskHubStore';

const identityA: TaskIdentity = { conversationId: 'conversation-a', taskId: 'shared-task' };
const identityB: TaskIdentity = { conversationId: 'conversation-b', taskId: 'shared-task' };

function task(identity: TaskIdentity, title: string): Task {
  return {
    id: identity.taskId,
    conversationId: identity.conversationId,
    phaseId: '',
    title,
    description: '',
    status: 'ready',
    agentId: 'mario',
    dependencies: [],
    artifacts: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    revision: 0,
  };
}

function acceptedTask(identity: TaskIdentity, title: string, status: Task['status'] = 'ready') {
  return {
    id: identity.taskId,
    conversation_id: identity.conversationId,
    title,
    description: '',
    status,
    agent_id: 'mario',
    dependencies: '[]',
    artifacts: '[]',
    created_at: '2026-08-26T00:00:00.000Z',
    updated_at: '2026-08-26T00:00:01.000Z',
    revision: 1,
  };
}

function acceptedReceipt(result?: Record<string, unknown>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      receipt: {
        idempotencyKey: crypto.randomUUID(),
        commandType: 'task.update',
        projectPath: '',
        deliveryId: '',
        status: 'accepted',
        duplicate: false,
        targetAgentIds: [],
        recordedAt: '2026-08-26T00:00:01.000Z',
        result,
      },
    }),
  } as Response;
}

describe('conversation-scoped task mutations', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: identityB.conversationId,
      selectedTaskId: identityB.taskId,
      conversations: [identityA, identityB].map((identity) => ({
        id: identity.conversationId,
        title: identity.conversationId,
        goal: '',
        status: 'active' as const,
        priority: 'p2' as const,
        projectPath: '',
        breakdownStatus: 'none' as const,
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z',
      })),
      tasks: [task(identityA, 'A task'), task(identityB, 'B task')],
      eventsByConversation: { 'conversation-a': [], 'conversation-b': [] },
      chatMessagesByConversation: { 'conversation-a': [], 'conversation-b': [] },
      blockersByConversation: { 'conversation-a': [], 'conversation-b': [] },
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('deletes only the selected conversation task', () => {
    useTaskHubStore.getState().removeTask(identityB);

    expect(useTaskHubStore.getState().getTaskByIdentity(identityA)?.title).toBe('A task');
    expect(useTaskHubStore.getState().getTaskByIdentity(identityB)).toBeUndefined();
    expect(useTaskHubStore.getState().selectedTaskId).toBeNull();
  });

  it('updates only the addressed conversation task', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(acceptedReceipt({
      task: acceptedTask(identityB, 'B updated'),
    }));

    await useTaskHubStore.getState().updateTask(identityB, { title: 'B updated' });

    expect(useTaskHubStore.getState().getTaskByIdentity(identityA)?.title).toBe('A task');
    expect(useTaskHubStore.getState().getTaskByIdentity(identityB)?.title).toBe('B updated');
  });

  it('isolates concurrent transition epochs for colliding ids', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (_input, init) => {
      const command = JSON.parse(String(init?.body)) as { deliveryId: string; status: Task['status'] };
      const identity = command.deliveryId === identityA.conversationId ? identityA : identityB;
      return acceptedReceipt({
        task: acceptedTask(identity, identity === identityA ? 'A task' : 'B task', command.status),
      });
    });

    await Promise.all([
      useTaskHubStore.getState().updateTaskStatus(identityA, 'in_progress'),
      useTaskHubStore.getState().updateTaskStatus(identityB, 'blocked'),
    ]);

    expect(useTaskHubStore.getState().getTaskByIdentity(identityA)?.status).toBe('in_progress');
    expect(useTaskHubStore.getState().getTaskByIdentity(identityB)?.status).toBe('blocked');
  });

  it('submits progress for the addressed conversation', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(acceptedReceipt());

    const result = await useTaskHubStore.getState().requestTaskProgress(identityB, '进度如何？');

    expect(result).toEqual({ ok: true });
    const body = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ deliveryId: identityB.conversationId, taskId: identityB.taskId });
  });
});
