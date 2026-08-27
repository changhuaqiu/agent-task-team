'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, RotateCcw } from 'lucide-react';

interface QueueFailure {
  id: string;
  agentId: string;
  source: string;
  taskId?: string;
  attempts: number;
  reasonCode: string;
  failedAt: string;
}

export function ProjectQueueFailuresPanel({ projectId }: { projectId: string }) {
  const [items, setItems] = useState<QueueFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/agent-inbox-failures?projectId=${encodeURIComponent(projectId)}`);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '失败队列读取失败');
      setItems(Array.isArray(body.failures) ? body.failures : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '失败队列读取失败');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function retry(item: QueueFailure) {
    setRetryingId(item.id);
    setError('');
    try {
      const response = await fetch('/api/agent-inbox-failures', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'retry', itemId: item.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? '重新入队失败');
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新入队失败');
    } finally {
      setRetryingId(null);
    }
  }

  return <section className="mb-4 overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--bg-card))]" aria-label="失败队列"><header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3"><div><div className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="size-3.5 text-amber-500" />失败队列</div><p className="mt-1 text-[11px] text-[hsl(var(--text-tertiary))]">超过启动重试上限的 Agent 工作会保留在这里，不会静默丢失。</p></div><button type="button" onClick={() => void load()} disabled={loading} aria-label="刷新失败队列" className="flex size-8 items-center justify-center rounded-lg border border-[hsl(var(--border))] disabled:opacity-50">{loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}</button></header>{error && <div role="alert" className="m-3 rounded-lg bg-[hsl(var(--status-rejected-bg))] px-3 py-2 text-[11px] text-[hsl(var(--status-rejected))]">{error}</div>}{!loading && items.length === 0 ? <div className="px-4 py-6 text-center text-xs text-[hsl(var(--text-tertiary))]">没有需要人工处理的失败工作</div> : <div className="divide-y divide-[hsl(var(--border-subtle))]">{items.map((item) => <div key={item.id} className="flex items-start gap-3 px-4 py-3"><div className="min-w-0 flex-1"><div className="text-xs font-medium">{item.agentId}{item.taskId ? ` · ${item.taskId}` : ''}</div><div className="mt-1 break-all text-[10px] text-[hsl(var(--text-tertiary))]">{item.reasonCode} · 已尝试 {item.attempts} 次 · {new Date(item.failedAt).toLocaleString('zh-CN')}</div></div><button type="button" onClick={() => void retry(item)} disabled={Boolean(retryingId)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[hsl(var(--border))] px-2.5 text-[11px] disabled:opacity-50">{retryingId === item.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}重新入队</button></div>)}</div>}</section>;
}
