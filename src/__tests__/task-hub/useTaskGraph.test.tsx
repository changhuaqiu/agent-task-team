// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskGraph } from '@/components/task-hub/useTaskGraph';
import type { TaskGraphApiView } from '@/lib/taskGraphView';

function graph(conversationId: string): TaskGraphApiView {
  return {
    conversationId,
    revision: 1,
    tasks: [],
    edges: [],
    actions: [],
    artifacts: [],
    bindings: [],
  };
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTaskGraph', () => {
  it('does not let a slower previous delivery overwrite the selected delivery graph', async () => {
    const requestA = deferredResponse();
    const requestB = deferredResponse();
    vi.stubGlobal('fetch', vi.fn()
      .mockReturnValueOnce(requestA.promise)
      .mockReturnValueOnce(requestB.promise));

    const { result, rerender } = renderHook(
      ({ conversationId }) => useTaskGraph(conversationId),
      { initialProps: { conversationId: 'delivery-a' } },
    );
    rerender({ conversationId: 'delivery-b' });

    await act(async () => {
      requestB.resolve({ ok: true, json: async () => graph('delivery-b') } as Response);
      await requestB.promise;
    });
    expect(result.current.graph?.conversationId).toBe('delivery-b');

    await act(async () => {
      requestA.resolve({ ok: true, json: async () => graph('delivery-a') } as Response);
      await requestA.promise;
    });
    expect(result.current.graph?.conversationId).toBe('delivery-b');
  });
});
