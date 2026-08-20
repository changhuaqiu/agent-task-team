'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskGraphApiView } from '@/lib/taskGraphView';

export function useTaskGraph(conversationId: string | null | undefined, enabled = true) {
  const [graph, setGraph] = useState<TaskGraphApiView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    activeRequest.current?.abort();
    if (!conversationId || !enabled) {
      setGraph(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    activeRequest.current = controller;
    setIsLoading(true);
    setGraph(null);
    setError(null);
    try {
      const response = await fetch(`/api/task-graph?conversationId=${encodeURIComponent(conversationId)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`任务图加载失败：${response.status}`);
      const nextGraph = await response.json() as TaskGraphApiView;
      if (requestSequence.current === requestId && nextGraph.conversationId === conversationId) {
        setGraph(nextGraph);
        setError(null);
      }
    } catch (err) {
      if (requestSequence.current === requestId && !(err instanceof DOMException && err.name === 'AbortError')) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestSequence.current === requestId) setIsLoading(false);
    }
  }, [conversationId, enabled]);

  useEffect(() => {
    // Loading an external projection is the synchronization this effect owns.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    return () => {
      activeRequest.current?.abort();
    };
  }, [refresh]);

  return { graph, isLoading, error, refresh };
}
