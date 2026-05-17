'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TaskGraphApiView } from '@/lib/taskGraphView';

export function useTaskGraph(conversationId: string | null | undefined) {
  const [graph, setGraph] = useState<TaskGraphApiView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setGraph(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/task-graph?conversationId=${encodeURIComponent(conversationId)}`);
      if (!response.ok) throw new Error(`任务图加载失败：${response.status}`);
      setGraph(await response.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { graph, isLoading, error, refresh };
}
