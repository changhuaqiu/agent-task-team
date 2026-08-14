import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('browser task creation status boundary', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-task-create',
      tasks: [],
      dispatchToAgent: vi.fn() as never,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses ready optimistically and does not send an ignored initial status', () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    useTaskHubStore.getState().addTask({
      title: 'Canonical task',
      description: 'Use the Task Authority lifecycle.',
      agentId: 'mario',
      dependencies: [],
      artifacts: [],
    });

    expect(useTaskHubStore.getState().tasks).toContainEqual(
      expect.objectContaining({ title: 'Canonical task', status: 'ready' }),
    );
    const request = fetchSpy.mock.calls.find(([url]) => url === '/api/mutations')?.[1];
    const body = JSON.parse(String(request?.body)) as { payload: Record<string, unknown> };
    expect(body.payload).not.toHaveProperty('status');
  });
});
