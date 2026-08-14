// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('phase persistence interface', () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      selectedConversationId: 'project-a',
      phases: [],
    });
  });

  it('persists optimistic phase creates and deletes through /api/phases', () => {
    const id = useTaskHubStore.getState().upsertPhase({
      conversationId: 'project-a',
      title: 'Plan',
      description: 'Plan the work',
      order: 0,
      status: 'planned',
    });

    expect(useTaskHubStore.getState().phases).toEqual([
      expect.objectContaining({ id, conversationId: 'project-a', title: 'Plan' }),
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/phases', expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({
      id,
      conversationId: 'project-a',
      title: 'Plan',
      description: 'Plan the work',
      order: 0,
      status: 'planned',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });

    useTaskHubStore.getState().removePhase(id);

    expect(useTaskHubStore.getState().phases).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/phases?id=${encodeURIComponent(id)}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
