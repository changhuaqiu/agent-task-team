import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';
import { socket } from '@/store/daemonStore';

function emitServerEvent(event: string, payload: unknown) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent([event, payload]);
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
    const update = useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

    expect(useTaskHubStore.getState().getTaskById('TASK-015')?.status).toBe('ready');
    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toEqual([]);
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toEqual([]);

    resolveMutation({
      ok: true,
      status: 200,
      json: async () => ({ result: acceptedTask('in_progress', 1) }),
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
    expect(fetchSpy).toHaveBeenCalledWith('/api/mutations', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('task.updateStatus'),
    }));
  });

  it('rolls back a 403 and creates the server blocker without success side effects', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Only the task owner can change this status.' }),
      } as Response)
      .mockResolvedValue({ ok: true } as Response);
    await useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

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
    await useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

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

    const older = useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');
    const newer = useTaskHubStore.getState().updateTaskStatus('TASK-015', 'blocked');
    resolvers[1]({
      ok: true,
      status: 200,
      json: async () => ({ result: acceptedTask('blocked', 2) }),
    } as Response);
    await newer;
    resolvers[0]({
      ok: true,
      status: 200,
      json: async () => ({ result: acceptedTask('in_progress', 1) }),
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
    const update = useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

    emitServerEvent('task.state', {
      projectId: 'conv-1',
      task: {
        ...acceptedTask('blocked', 2),
        phase_id: 'P1',
      },
    });
    resolveMutation({
      ok: true,
      status: 200,
      json: async () => ({ result: acceptedTask('in_progress', 1) }),
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
