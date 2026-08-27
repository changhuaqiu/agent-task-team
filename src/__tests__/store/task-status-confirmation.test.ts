import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';
import { socket } from '@/store/daemonStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
}

function emitTaskState(taskRow: Record<string, unknown>): void {
  emitServerEvent('project:view', {
    version: 2,
    envelopeVersion: 1,
    eventId: `task-state-${String(taskRow.id)}-${String(taskRow.revision)}`,
    projectId: 'conv-1',
    occurredAt: '2026-07-19T00:00:02.000Z',
    type: 'task.state',
    delivery: 'durable',
    actor: { type: 'system', id: 'task-command-service' },
    subject: { type: 'task', id: String(taskRow.id) },
    correlationId: String(taskRow.id),
    causationId: `task-revision:${String(taskRow.id)}:${String(taskRow.revision ?? 0)}`,
    payload: { task: taskRow },
  });
}

const task = {
  id: 'TASK-015',
  conversationId: 'conv-1',
  phaseId: 'P1',
  title: 'Confirm task status',
  description: 'Publish status effects only after server confirmation.',
  status: 'ready' as const,
  agentId: 'luigi',
  dependencies: [],
  artifacts: [],
  createdAt: '2026-07-19T00:00:00.000Z',
  updatedAt: '2026-07-19T00:00:00.000Z',
  revision: 0,
};

function acceptedTask(status: 'in_progress' | 'blocked', revision: number) {
  return {
    id: task.id,
    conversation_id: task.conversationId,
    title: task.title,
    description: task.description,
    status,
    agent_id: task.agentId,
    dependencies: '[]',
    artifacts: '[]',
    revision,
    created_at: task.createdAt,
    updated_at: `2026-07-19T00:00:0${revision}.000Z`,
  };
}

describe('task.updateStatus confirmation boundary', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      selectedProjectId: 'conv-1',
      conversations: [{
        id: 'conv-1', title: 'Status task', goal: '', status: 'active', priority: 'p1',
        projectPath: '', breakdownStatus: 'confirmed', createdAt: '', updatedAt: '',
      }],
      tasks: [task],
      chatMessagesByConversation: { 'conv-1': [] },
      eventsByConversation: { 'conv-1': [] },
      blockersByConversation: { 'conv-1': [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes the event and chat card only after the server accepts the status command', async () => {
    let resolveMutation!: (response: Response) => void;
    const mutationResponse = new Promise<Response>((resolve) => {
      resolveMutation = resolve;
    });
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockImplementationOnce(() => mutationResponse)
      .mockResolvedValue({ ok: true } as Response);
    const update = useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'in_progress');

    expect(useTaskHubStore.getState().getTaskById('TASK-015')?.status).toBe('ready');
    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toEqual([]);
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toEqual([]);

    resolveMutation({
      ok: true,
      status: 200,
      json: async () => ({ receipt: {
        idempotencyKey: 'status-1', commandType: 'task.transition', projectPath: '', deliveryId: 'conv-1',
        status: 'accepted', duplicate: false, targetAgentIds: [], recordedAt: '2026-07-19T00:00:01.000Z',
        result: { task: acceptedTask('in_progress', 1) },
      } }),
    } as Response);
    await update;

    expect(useTaskHubStore.getState().getTaskById('TASK-015')).toMatchObject({
      status: 'in_progress',
      revision: 1,
    });
    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ type: 'task.status_changed' }),
    );
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ intent: 'task_status', metadata: expect.objectContaining({ status: 'in_progress' }) }),
    );
    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('/api/workspace-commands', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('task.transition'),
    }));
  });

  it('rolls back a 403 and creates the server blocker without success side effects', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ receipt: {
          idempotencyKey: 'status-rejected', commandType: 'task.transition', projectPath: '', deliveryId: 'conv-1',
          status: 'rejected', duplicate: false, targetAgentIds: [], recordedAt: '2026-07-19T00:00:01.000Z',
          userMessage: 'Only the task owner can change this status.',
        } }),
      } as Response)
      .mockResolvedValue({ ok: true } as Response);
    await useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'in_progress');

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('TASK-015')).toEqual(task);
    expect(state.eventsByConversation['conv-1'].filter((event) => event.type === 'task.status_changed')).toEqual([]);
    expect(state.chatMessagesByConversation['conv-1']).toEqual([]);
    expect(state.blockersByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ reasonSummary: 'Only the task owner can change this status.' }),
    );
  });

  it('rolls back a network failure and exposes the network error without success side effects', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValue({ ok: true } as Response);
    await useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'in_progress');

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('TASK-015')).toEqual(task);
    expect(state.eventsByConversation['conv-1'].filter((event) => event.type === 'task.status_changed')).toEqual([]);
    expect(state.chatMessagesByConversation['conv-1']).toEqual([]);
    expect(state.blockersByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ reasonSummary: '状态流转到 in_progress 失败：Network request failed' }),
    );
  });

  it('does not let an older response overwrite a newer authoritative task revision', async () => {
    const resolvers: Array<(response: Response) => void> = [];
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolvers.push(resolve);
    }));

    const older = useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'in_progress');
    const newer = useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'blocked');
    resolvers[1]({
      ok: true,
      status: 200,
      json: async () => ({ receipt: {
        idempotencyKey: 'newer', commandType: 'task.transition', projectPath: '', deliveryId: 'conv-1',
        status: 'accepted', duplicate: false, targetAgentIds: [], recordedAt: '', result: { task: acceptedTask('blocked', 2) },
      } }),
    } as Response);
    await newer;
    resolvers[0]({
      ok: true,
      status: 200,
      json: async () => ({ receipt: {
        idempotencyKey: 'older', commandType: 'task.transition', projectPath: '', deliveryId: 'conv-1',
        status: 'accepted', duplicate: false, targetAgentIds: [], recordedAt: '', result: { task: acceptedTask('in_progress', 1) },
      } }),
    } as Response);
    await older;

    expect(useTaskHubStore.getState().getTaskById('TASK-015')).toMatchObject({
      status: 'blocked',
      revision: 2,
    });
  });

  it('does not let a delayed HTTP response overwrite a newer socket projection', async () => {
    let resolveMutation!: (response: Response) => void;
    vi.spyOn(global, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolveMutation = resolve;
    }));
    const update = useTaskHubStore.getState().updateTaskStatus({ conversationId: 'conv-1', taskId: 'TASK-015' }, 'in_progress');

    emitTaskState({
        ...acceptedTask('blocked', 2),
        phase_id: 'P1',
    });
    resolveMutation({
      ok: true,
      status: 200,
      json: async () => ({ receipt: {
        idempotencyKey: 'delayed', commandType: 'task.transition', projectPath: '', deliveryId: 'conv-1',
        status: 'accepted', duplicate: false, targetAgentIds: [], recordedAt: '', result: { task: acceptedTask('in_progress', 1) },
      } }),
    } as Response);
    await update;

    expect(useTaskHubStore.getState().getTaskById('TASK-015')).toMatchObject({
      status: 'blocked',
      revision: 2,
    });
    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toEqual([]);
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toEqual([]);
  });
});
