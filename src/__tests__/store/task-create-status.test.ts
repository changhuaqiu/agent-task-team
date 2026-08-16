import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('browser task creation status boundary', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-task-create',
      tasks: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('projects the server task only after creation is confirmed', async () => {
    let resolveMutation!: (response: Response) => void;
    const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(() => new Promise((resolve) => {
      resolveMutation = resolve;
    }));

    const pending = useTaskHubStore.getState().addTask({
      title: 'Canonical task',
      description: 'Use the Task Authority lifecycle.',
      agentId: 'mario',
      dependencies: [],
      artifacts: [],
    });

    expect(useTaskHubStore.getState().tasks).toEqual([]);
    resolveMutation({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          id: 'TASK-001',
          conversation_id: 'conv-task-create',
          title: 'Canonical task',
          description: 'Use the Task Authority lifecycle.',
          status: 'ready',
          agent_id: 'mario',
          dependencies: '[]',
          artifacts: '[]',
          revision: 0,
          created_at: '2026-08-16T00:00:00.000Z',
          updated_at: '2026-08-16T00:00:00.000Z',
        },
      }),
    } as Response);
    await pending;

    expect(useTaskHubStore.getState().tasks).toContainEqual(
      expect.objectContaining({ title: 'Canonical task', status: 'ready', revision: 0 }),
    );
    const request = fetchSpy.mock.calls.find(([url]) => url === '/api/mutations')?.[1];
    const body = JSON.parse(String(request?.body)) as { payload: Record<string, unknown> };
    expect(body.payload).not.toHaveProperty('status');
  });
});
