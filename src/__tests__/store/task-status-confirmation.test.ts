import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

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
};

describe('task.updateStatus confirmation boundary', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      tasks: [task],
      chatMessagesByConversation: { 'conv-1': [] },
      eventsByConversation: { 'conv-1': [] },
      blockersByConversation: { 'conv-1': [] },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes the event, chat card, and in-progress dispatch only after response.ok', async () => {
    let resolveMutation!: (response: Response) => void;
    const mutationResponse = new Promise<Response>((resolve) => {
      resolveMutation = resolve;
    });
    const fetchSpy = vi.spyOn(global, 'fetch')
      .mockImplementationOnce(() => mutationResponse)
      .mockResolvedValue({ ok: true } as Response);
    const dispatchToAgent = vi.fn();
    useTaskHubStore.setState({ dispatchToAgent: dispatchToAgent as never });

    const update = useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

    expect(useTaskHubStore.getState().getTaskById('TASK-015')?.status).toBe('in_progress');
    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toEqual([]);
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toEqual([]);
    expect(dispatchToAgent).not.toHaveBeenCalled();

    resolveMutation({ ok: true } as Response);
    await update;

    expect(useTaskHubStore.getState().eventsByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ type: 'task.status_changed' }),
    );
    expect(useTaskHubStore.getState().chatMessagesByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ intent: 'task_status', metadata: expect.objectContaining({ status: 'in_progress' }) }),
    );
    expect(dispatchToAgent).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalled();
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
    const dispatchToAgent = vi.fn();
    useTaskHubStore.setState({ dispatchToAgent: dispatchToAgent as never });

    await useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('TASK-015')).toEqual(task);
    expect(state.eventsByConversation['conv-1'].filter((event) => event.type === 'task.status_changed')).toEqual([]);
    expect(state.chatMessagesByConversation['conv-1']).toEqual([]);
    expect(state.blockersByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ reasonSummary: 'Only the task owner can change this status.' }),
    );
    expect(dispatchToAgent).not.toHaveBeenCalled();
  });

  it('rolls back a network failure and exposes the network error without success side effects', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValue({ ok: true } as Response);
    const dispatchToAgent = vi.fn();
    useTaskHubStore.setState({ dispatchToAgent: dispatchToAgent as never });

    await useTaskHubStore.getState().updateTaskStatus('TASK-015', 'in_progress');

    const state = useTaskHubStore.getState();
    expect(state.getTaskById('TASK-015')).toEqual(task);
    expect(state.eventsByConversation['conv-1'].filter((event) => event.type === 'task.status_changed')).toEqual([]);
    expect(state.chatMessagesByConversation['conv-1']).toEqual([]);
    expect(state.blockersByConversation['conv-1']).toContainEqual(
      expect.objectContaining({ reasonSummary: '状态流转到 in_progress 失败：Network request failed' }),
    );
    expect(dispatchToAgent).not.toHaveBeenCalled();
  });
});
