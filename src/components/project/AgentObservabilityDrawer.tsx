'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock3, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpanCallTree } from './SpanCallTree';

type Target = {
  conversationId: string;
  invocationId?: string;
  traceId?: string;
  agentId?: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  timestamp?: string;
};
type Span = { span_id: string; parent_span_id: string | null; kind: string; name: string; status: string; started_at: string; durationMs?: number; parsedAttributes?: Record<string, unknown> };
type Trace = { traceId: string; invocationId?: string; agentId?: string; startedAt: string; durationMs?: number; totalTokens: number; spans: Span[] };
type Payload = { role: string; seq: number; content: string; byte_size: number; truncated: number };

export function openAgentObservabilityDrawer(target: Target) {
  window.dispatchEvent(new CustomEvent<Target>('observability:open', { detail: target }));
}

function PayloadBlock({ label, payload }: { label: string; payload?: Payload }) {
  if (!payload) return null;
  return <section className="space-y-1.5">
    <div className="flex items-center gap-2 text-[10px] font-semibold text-[hsl(var(--text-secondary))]">
      <span>{label}</span>{Boolean(payload.truncated) && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[8px] text-amber-600">已按上限截断</span>}
    </div>
    <pre className="whitespace-pre-wrap break-words rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2.5 text-[9px] leading-relaxed text-[hsl(var(--text-secondary))]">{payload.content}</pre>
  </section>;
}

export function AgentObservabilityDrawer() {
  const [target, setTarget] = useState<Target>();
  const [trace, setTrace] = useState<Trace>();
  const [payloads, setPayloads] = useState<Record<string, Payload[]>>({});
  const [tab, setTab] = useState<'prompt' | 'tools' | 'response'>('prompt');
  const [selectedSpanId, setSelectedSpanId] = useState<string>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<Target>).detail;
      if (!detail?.conversationId) return;
      setTarget(detail); setTrace(undefined); setPayloads({}); setTab('prompt'); setError(undefined); setLoading(true);
    };
    window.addEventListener('observability:open', open);
    return () => window.removeEventListener('observability:open', open);
  }, []);

  useEffect(() => {
    if (!target) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ conversationId: target.conversationId, limit: '100' });
    if (target.invocationId) params.set('invocationId', target.invocationId);
    else if (target.traceId) params.set('traceId', target.traceId);
    else if (target.agentId) params.set('agentId', target.agentId);
    else if (target.passId) params.set('passId', target.passId);
    else if (target.taskId) params.set('taskId', target.taskId);
    else if (target.chainId) params.set('chainId', target.chainId);
    fetch(`/api/observability?${params}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
        return response.json();
      })
      .then(snapshot => {
        const traces = (snapshot.traces || []) as Trace[];
        if (target.invocationId || target.traceId || !target.timestamp) setTrace(traces[0]);
        else {
          const at = new Date(target.timestamp).getTime();
          setTrace([...traces].sort((a, b) => Math.abs(new Date(a.startedAt).getTime() - at) - Math.abs(new Date(b.startedAt).getTime() - at))[0]);
        }
      })
      .catch(cause => { if (cause.name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [target]);

  const relevantSpans = useMemo(() => {
    if (!trace) return [];
    if (tab === 'prompt') return trace.spans.filter(span => span.kind === 'agent');
    if (tab === 'tools') return trace.spans.filter(span => span.kind === 'tool');
    return trace.spans.filter(span => span.kind === 'message');
  }, [trace, tab]);

  useEffect(() => {
    if (!target || !relevantSpans.length) return;
    const missing = relevantSpans.filter(span => !payloads[span.span_id]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(missing.map(async span => {
      const params = new URLSearchParams({ conversationId: target.conversationId, spanId: span.span_id });
      const response = await fetch(`/api/observability/span-payload?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`payload HTTP ${response.status}`);
      const body = await response.json();
      return [span.span_id, body.payloads || []] as const;
    })).then(entries => { if (!cancelled) setPayloads(current => ({ ...current, ...Object.fromEntries(entries) })); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [payloads, relevantSpans, target]);

  if (!target) return null;
  const close = () => setTarget(undefined);
  const rootStart = trace ? new Date(trace.startedAt).getTime() : 0;
  const total = Math.max(1, trace?.durationMs ?? Math.max(1, ...(trace?.spans.map(span => (new Date(span.started_at).getTime() - rootStart) + (span.durationMs ?? 1)) ?? [1])));

  return <>
    <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={close} />
    <aside className="fixed bottom-0 right-0 top-0 z-50 flex w-[min(820px,94vw)] flex-col border-l-2 border-[hsl(var(--text-primary))] bg-[hsl(var(--bg-elevated))] shadow-[-4px_0_0_hsl(var(--text-primary))] animate-slide-in-r" aria-label="Agent 调用详情">
      <header className="flex items-start justify-between border-b border-[hsl(var(--border))] px-5 py-4">
        <div><div className="flex items-center gap-2 text-sm font-bold"><Activity className="size-4" />Agent 调用详情</div><div className="mt-1 text-[10px] text-[hsl(var(--text-tertiary))]">{trace?.agentId ?? target.agentId ?? 'Agent'} · {target.invocationId ? '精确关联' : '历史就近匹配'}</div></div>
        <button type="button" onClick={close} aria-label="关闭调用详情" className="rounded p-1 hover:bg-[hsl(var(--bg-muted))]"><X className="size-4" /></button>
      </header>
      <div className="flex-1 min-h-0 space-y-4 overflow-y-auto p-5">
        {loading && <div className="flex items-center gap-2 text-xs text-[hsl(var(--text-tertiary))]"><Activity className="size-4 animate-pulse" />加载调用链…</div>}
        {error && <div className="flex gap-2 rounded-md border border-rose-300 bg-rose-50 p-2 text-[10px] text-rose-700"><AlertTriangle className="size-3.5 shrink-0" />{error}</div>}
        {!loading && !trace && !error && <div className="rounded-md border border-dashed p-5 text-center text-[10px] text-[hsl(var(--text-tertiary))]">未找到对应调用</div>}
        {trace && <>
          <section><div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold"><Clock3 className="size-3" />调用链</div>
            <div className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2">
              <SpanCallTree
                spans={trace.spans}
                rootStartedAt={trace.startedAt}
                totalMs={total}
                selectedSpanId={selectedSpanId}
                onSelectSpan={(spanId) => {
                  const span = trace.spans.find((s) => s.span_id === spanId);
                  if (span?.kind === 'tool') setTab('tools');
                  else if (span?.kind === 'message') setTab('response');
                  else if (span?.kind === 'agent') setTab('prompt');
                  setSelectedSpanId(spanId === selectedSpanId ? undefined : spanId);
                }}
              />
              <div className="mt-1 px-1 text-[8px] text-[hsl(var(--text-tertiary))]">点 span 按 kind 切换到对应明细 tab</div>
            </div>
          </section>
          <div className="flex border-b border-[hsl(var(--border-subtle))]">{(['prompt', 'tools', 'response'] as const).map(key => <button key={key} type="button" onClick={() => setTab(key)} className={cn('px-3 py-2 text-[10px]', tab === key ? 'border-b-2 border-[hsl(var(--accent))] font-semibold text-[hsl(var(--accent))]' : 'text-[hsl(var(--text-tertiary))]')}>{key === 'prompt' ? '提示词' : key === 'tools' ? '工具' : '模型回复'}</button>)}</div>
          {tab === 'prompt' && relevantSpans.flatMap(span => payloads[span.span_id] || []).map(payload => <PayloadBlock key={`${payload.role}:${payload.seq}`} label={payload.role === 'system_prompt' ? 'System prompt' : 'Assembled prompt'} payload={payload} />)}
          {tab === 'tools' && relevantSpans.map(span => <section key={span.span_id} className="space-y-2"><div className="text-[10px] font-semibold">{String(span.parsedAttributes?.['gen_ai.tool.name'] ?? span.name)}</div>{(payloads[span.span_id] || []).map(payload => <PayloadBlock key={`${payload.role}:${payload.seq}`} label={payload.role === 'tool_input' ? '输入' : '输出'} payload={payload} />)}</section>)}
          {tab === 'response' && relevantSpans.map(span => {
            const rows = payloads[span.span_id] || [];
            return <section key={span.span_id} className="space-y-3"><PayloadBlock label={`Completion · ${trace.totalTokens} tokens`} payload={rows.find(row => row.role === 'completion')} />{rows.find(row => row.role === 'thinking') && <details className="rounded-md border border-amber-200 bg-amber-50/60 p-2"><summary className="cursor-pointer text-[9px] font-semibold text-amber-700">Runtime 暴露的 thinking summary（敏感，默认折叠）</summary><div className="mt-2"><PayloadBlock label="Thinking" payload={rows.find(row => row.role === 'thinking')} /></div></details>}</section>;
          })}
        </>}
      </div>
    </aside>
  </>;
}
