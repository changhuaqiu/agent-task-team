'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Clock3, RefreshCw, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';

type Span = {
  span_id: string; parent_span_id: string | null; name: string; kind: string; status: string;
  started_at: string; durationMs?: number; parsedAttributes: Record<string, unknown>;
};
type Trace = {
  traceId: string; agentId?: string; taskId?: string; invocationId?: string; status: string;
  startedAt: string; durationMs?: number; engine?: string; totalTokens: number; tools: string[];
  context?: { scenario?: string; tokensUsed?: number; tokensBudget?: number; saturation?: number; loadedSkills?: string[]; availableTools?: string[]; layers?: Array<{ layer: string; tokens: number; trimmed: boolean }> };
  spans: Span[];
};
type Snapshot = {
  generatedAt: string;
  summary: { traceCount: number; agentCount: number; toolCallCount: number; failedTraceCount: number; totalTokens: number; averageDurationMs: number };
  agents: Array<{ agentId: string; traceCount: number; toolCallCount: number; failedTraceCount: number }>;
  traces: Trace[];
  workflow: { agentEdges: Array<{ fromAgentId: string; toAgentId: string; count: number }> };
};

function formatDuration(ms?: number): string {
  if (ms === undefined) return '进行中';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function Metric({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-2 py-2">
    <div className={cn('text-sm font-bold tabular-nums', danger ? 'text-[hsl(var(--status-rejected))]' : 'text-[hsl(var(--text-primary))]')}>{value}</div>
    <div className="mt-0.5 text-[9px] text-[hsl(var(--text-tertiary))]">{label}</div>
  </div>;
}

export function ProjectObservabilityPanel({ conversationId }: { conversationId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string>();

  const load = async (signal?: AbortSignal) => {
    if (!conversationId) { setSnapshot(undefined); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/observability?conversationId=${encodeURIComponent(conversationId)}`, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
      setSnapshot(await response.json()); setError(undefined);
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (!signal?.aborted) setLoading(false); }
  };

  useEffect(() => {
    const controller = new AbortController();
    const initialTimer = window.setTimeout(() => void load(controller.signal), 0);
    const timer = window.setInterval(() => void load(controller.signal), 5_000);
    return () => { controller.abort(); window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxSpanDuration = useMemo(() => Math.max(1, ...(snapshot?.traces.flatMap(trace => trace.spans.map(span => span.durationMs ?? 0)) ?? [1])), [snapshot]);
  if (!conversationId) return <div className="p-6 text-center text-xs text-[hsl(var(--text-tertiary))]">选择项目后查看调试数据</div>;

  return <div className="space-y-3">
    <div className="flex items-center justify-between">
      <div><div className="text-xs font-semibold text-[hsl(var(--text-primary))]">Agent 调试</div><div className="text-[9px] text-[hsl(var(--text-tertiary))]">上下文、工具与协作链路</div></div>
      <button type="button" onClick={() => void load()} aria-label="刷新调试数据" className="rounded-md p-1.5 text-[hsl(var(--text-tertiary))] hover:bg-[hsl(var(--bg-card-hover))]"><RefreshCw className={cn('size-3.5', loading && 'animate-spin')} /></button>
    </div>
    {error && <div className="rounded-md border border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] p-2 text-[10px] text-[hsl(var(--status-rejected))]">{error}</div>}
    {snapshot && <>
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Agent turns" value={snapshot.summary.traceCount}/><Metric label="工具调用" value={snapshot.summary.toolCallCount}/><Metric label="失败" value={snapshot.summary.failedTraceCount} danger={snapshot.summary.failedTraceCount > 0}/>
        <Metric label="活跃角色" value={snapshot.summary.agentCount}/><Metric label="Tokens" value={snapshot.summary.totalTokens}/><Metric label="平均耗时" value={formatDuration(snapshot.summary.averageDurationMs)}/>
      </div>
      {snapshot.workflow.agentEdges.length > 0 && <section className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="mb-2 text-[10px] font-semibold text-[hsl(var(--text-secondary))]">Agent 交互</div>
        <div className="flex flex-wrap gap-1.5">{snapshot.workflow.agentEdges.map(edge => <span key={`${edge.fromAgentId}:${edge.toAgentId}`} className="rounded-full border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-2 py-1 text-[9px] text-[hsl(var(--text-secondary))]">{edge.fromAgentId} → {edge.toAgentId} · {edge.count}</span>)}</div>
      </section>}
      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold text-[hsl(var(--text-secondary))]">执行记录</div>
        {snapshot.traces.length === 0 ? <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-6 text-center text-[10px] text-[hsl(var(--text-tertiary))]">还没有可观测的 Agent turn。下一次执行会自动记录。</div> : snapshot.traces.map(trace => {
          const open = expanded === trace.traceId;
          return <article key={trace.traceId} className="overflow-hidden rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))]">
            <button type="button" onClick={() => setExpanded(open ? undefined : trace.traceId)} className="flex w-full items-start gap-2 p-2.5 text-left hover:bg-[hsl(var(--bg-card-hover))]">
              {open ? <ChevronDown className="mt-0.5 size-3.5 shrink-0"/> : <ChevronRight className="mt-0.5 size-3.5 shrink-0"/>}
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className={cn('size-1.5 rounded-full', trace.status === 'ok' ? 'bg-emerald-500' : trace.status === 'error' ? 'bg-rose-500' : 'bg-amber-500')}/><span className="truncate text-[11px] font-semibold">{trace.agentId ?? 'Agent'}</span>{trace.engine && <span className="text-[9px] text-[hsl(var(--text-tertiary))]">{trace.engine}</span>}</div><div className="mt-1 flex gap-2 text-[9px] text-[hsl(var(--text-tertiary))]"><span className="inline-flex items-center gap-0.5"><Clock3 className="size-2.5"/>{formatDuration(trace.durationMs)}</span><span>{trace.totalTokens} tokens</span>{trace.taskId && <span>{trace.taskId}</span>}</div></div>
            </button>
            {open && <div className="space-y-3 border-t border-[hsl(var(--border-subtle))] p-2.5">
              {trace.context && <div><div className="mb-1 text-[9px] font-semibold text-[hsl(var(--text-secondary))]">上下文 · {trace.context.scenario ?? 'unknown'} · {trace.context.tokensUsed ?? 0}/{trace.context.tokensBudget ?? 0}</div><div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg-muted))]"><div className="h-full bg-[hsl(var(--accent))]" style={{ width: `${Math.min(100, (trace.context.saturation ?? 0) * 100)}%` }}/></div><div className="mt-1.5 flex flex-wrap gap-1">{trace.context.loadedSkills?.map(skill => <span key={skill} className="rounded bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[8px] text-[hsl(var(--accent))]">Skill · {skill}</span>)}</div></div>}
              {trace.tools.length > 0 && <div className="flex flex-wrap gap-1">{trace.tools.map(tool => <span key={tool} className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5 text-[8px]"><Wrench className="size-2.5"/>{tool}</span>)}</div>}
              <div className="space-y-1">{trace.spans.map(span => <div key={span.span_id} className="grid grid-cols-[70px_1fr_45px] items-center gap-1 text-[8px]"><span className="truncate text-[hsl(var(--text-secondary))]">{span.kind}</span><div className="h-2 overflow-hidden rounded bg-[hsl(var(--bg-muted))]"><div className={cn('h-full rounded', span.status === 'error' ? 'bg-rose-500' : span.kind === 'tool' ? 'bg-amber-500' : span.kind === 'context' ? 'bg-violet-500' : 'bg-cyan-500')} style={{ width: `${Math.max(4, ((span.durationMs ?? 1) / maxSpanDuration) * 100)}%` }}/></div><span className="text-right tabular-nums text-[hsl(var(--text-tertiary))]">{formatDuration(span.durationMs)}</span></div>)}</div>
              <details><summary className="cursor-pointer text-[8px] text-[hsl(var(--text-tertiary))]">技术标识</summary><div className="mt-1 break-all font-mono text-[8px] text-[hsl(var(--text-tertiary))]">trace {trace.traceId}<br/>invocation {trace.invocationId ?? '—'}</div></details>
            </div>}
          </article>;
        })}
      </section>
    </>}
    {!snapshot && !error && <div className="flex items-center justify-center gap-2 p-8 text-[10px] text-[hsl(var(--text-tertiary))]"><Activity className="size-4 animate-pulse"/>正在加载调试数据</div>}
  </div>;
}
