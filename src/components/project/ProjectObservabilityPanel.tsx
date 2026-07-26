'use client';

import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, Clock3, RefreshCw, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AgentChainGraph, type ObservationChain } from './AgentChainGraph';
import { openAgentObservabilityDrawer } from './AgentObservabilityDrawer';
import { SpanCallTree } from './SpanCallTree';
import { socket } from '@/store/daemonStore';

type Span = {
  span_id: string; parent_span_id: string | null; name: string; kind: string; status: string;
  started_at: string; durationMs?: number; parsedAttributes: Record<string, unknown>;
};
type Trace = {
  traceId: string; agentId?: string; taskId?: string; invocationId?: string; status: string;
  startedAt: string; durationMs?: number; engine?: string; totalTokens: number; tools: string[];
  context?: {
    scenario?: string; tokensUsed?: number; tokensBudget?: number; saturation?: number;
    loadedSkills?: string[]; availableTools?: string[];
    eligibleSkills?: Array<{ skillId: string; name: string; revision: string }>;
    activatedSkills?: Array<{ skillId: string; name: string; revision: string; activationReason: string }>;
    skillDecisions?: Array<{ skillId: string; name: string; revision: string; outcome: 'loaded' | 'omitted' | 'trimmed' | 'failed'; reasonCode: string }>;
    layers?: Array<{ layer: string; tokens: number; trimmed: boolean }>;
    snapshotId?: string;
    fragmentCount?: number;
    missingRequired?: string[];
    omissions?: Array<{ fragmentId: string; producer: string; reason: string; required: boolean }>;
  };
  spans: Span[];
};
type Snapshot = {
  generatedAt: string;
  summary: { traceCount: number; agentCount: number; toolCallCount: number; failedTraceCount: number; totalTokens: number; averageDurationMs: number };
  agents: Array<{ agentId: string; traceCount: number; toolCallCount: number; failedTraceCount: number }>;
  traces: Trace[];
  chains: ObservationChain[];
  workflow: {
    agentEdges: Array<{ fromAgentId: string; toAgentId: string; count: number }>;
    taskChains: Array<{ taskId: string; chainIds: string[]; agentIds: string[]; traceIds: string[] }>;
  };
};

function formatDuration(ms?: number): string {
  if (ms === undefined) return '进行中';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function payloadLabel(role: string): string {
  switch (role) {
    case 'system_prompt': return 'System prompt';
    case 'assembled_prompt': return 'Assembled prompt';
    case 'completion': return '模型回复';
    case 'tool_input': return '工具输入';
    case 'tool_output': return '工具输出';
    case 'thinking': return 'Thinking';
    default: return role;
  }
}

function Metric({ label, value, danger }: { label: string; value: string | number; danger?: boolean }) {
  return <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] px-2 py-2">
    <div className={cn('text-sm font-bold tabular-nums', danger ? 'text-[hsl(var(--status-rejected))]' : 'text-[hsl(var(--text-primary))]')}>{value}</div>
    <div className="mt-0.5 text-[9px] text-[hsl(var(--text-tertiary))]">{label}</div>
  </div>;
}

const SKILL_OUTCOME_LABEL = { loaded: '已加载', omitted: '未加载', trimmed: '已裁剪', failed: '失败' } as const;

export function ProjectObservabilityPanel({ conversationId }: { conversationId?: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  // 单 span 下钻：选中的 spanId（per-trace）+ payload 缓存
  const [selectedSpanId, setSelectedSpanId] = useState<string>();
  const [spanPayloads, setSpanPayloads] = useState<Record<string, Array<{ role: string; seq: number; content: string; byte_size: number; truncated: number }>>>();

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
    const refresh = (event: { projectId?: string; conversationId?: string }) => {
      if ((event?.projectId ?? event?.conversationId) === conversationId) void load();
    };
    socket.on('observability:updated', refresh);
    return () => { controller.abort(); window.clearTimeout(initialTimer); socket.off('observability:updated', refresh); };
  }, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 单 span payload 懒加载：选中 span 时按需拉取（仅在未缓存时）
  useEffect(() => {
    if (!conversationId || !selectedSpanId || spanPayloads?.[selectedSpanId]) return;
    let cancelled = false;
    const params = new URLSearchParams({ conversationId, spanId: selectedSpanId });
    fetch(`/api/observability/span-payload?${params}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error(`payload HTTP ${response.status}`);
        return (await response.json()).payloads as Array<{ role: string; seq: number; content: string; byte_size: number; truncated: number }>;
      })
      .then((payloads) => {
        if (!cancelled) setSpanPayloads((current) => ({ ...current, [selectedSpanId]: payloads }));
      })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => { cancelled = true; };
  }, [conversationId, selectedSpanId, spanPayloads]);

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
      <section className="space-y-2 rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div><div className="text-[10px] font-semibold text-[hsl(var(--text-secondary))]">Agent 调用链</div><div className="text-[8px] text-[hsl(var(--text-tertiary))]">基于 chain / pass / audit 显式事实，不解析聊天正文</div></div>
        <AgentChainGraph chains={snapshot.chains || []} onSelectTrace={traceId => openAgentObservabilityDrawer({ conversationId, traceId })} />
      </section>
      {(snapshot.workflow.taskChains?.length ?? 0) > 0 && <section className="rounded-lg border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-card))] p-2.5">
        <div className="mb-2 text-[10px] font-semibold text-[hsl(var(--text-secondary))]">Task × Chain</div>
        <div className="space-y-1.5">{snapshot.workflow.taskChains.map(item => <div key={item.taskId} className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-2"><div className="text-[9px] font-semibold">{item.taskId}</div><div className="mt-1 flex flex-wrap gap-1">{item.chainIds.map(chainId => <span key={chainId} className="rounded bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[8px] text-[hsl(var(--accent))]">{chainId}</span>)}{item.agentIds.map(agentId => <span key={agentId} className="rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5 text-[8px]">{agentId}</span>)}</div></div>)}</div>
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
              {trace.context && <div>
                <div className="mb-1 text-[9px] font-semibold text-[hsl(var(--text-secondary))]">上下文 · {trace.context.scenario ?? 'unknown'} · {trace.context.tokensUsed ?? 0}/{trace.context.tokensBudget ?? 0}</div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[hsl(var(--bg-muted))]"><div className="h-full bg-[hsl(var(--accent))]" style={{ width: `${Math.min(100, (trace.context.saturation ?? 0) * 100)}%` }}/></div>
                {trace.context.snapshotId && <div className="mt-1 flex flex-wrap gap-1 text-[8px] text-[hsl(var(--text-tertiary))]">
                  <span className="rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5 font-mono">Snapshot {trace.context.snapshotId.slice(0, 16)}</span>
                  <span className="rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5">已加载 {trace.context.fragmentCount ?? 0}</span>
                  <span className={cn('rounded border px-1.5 py-0.5', trace.context.missingRequired?.length ? 'border-[hsl(var(--status-rejected-border))] text-[hsl(var(--status-rejected))]' : 'border-[hsl(var(--border-subtle))]')}>必需缺失 {trace.context.missingRequired?.length ?? 0}</span>
                  <span className="rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5">省略 {trace.context.omissions?.length ?? 0}</span>
                </div>}
                {trace.context.eligibleSkills && <div className="mt-1 text-[8px] text-[hsl(var(--text-tertiary))]">已绑定 {trace.context.eligibleSkills.length} · 本轮激活 {trace.context.activatedSkills?.length ?? 0} · 已编入 {trace.context.skillDecisions?.filter(item => item.outcome === 'loaded').length ?? trace.context.loadedSkills?.length ?? 0}</div>}
                <div className="mt-1.5 flex flex-wrap gap-1">{trace.context.skillDecisions?.length ? trace.context.skillDecisions.map(skill => <span key={`${skill.skillId}:${skill.revision}`} title={skill.reasonCode} className={cn('rounded border px-1.5 py-0.5 text-[8px]', skill.outcome === 'loaded' ? 'border-[hsl(var(--accent)/0.3)] bg-[hsl(var(--accent-soft))] text-[hsl(var(--accent))]' : skill.outcome === 'failed' ? 'border-[hsl(var(--status-rejected-border))] bg-[hsl(var(--status-rejected-bg))] text-[hsl(var(--status-rejected))]' : 'border-[hsl(var(--border-subtle))] text-[hsl(var(--text-tertiary))]')}>Skill · {skill.name} · {SKILL_OUTCOME_LABEL[skill.outcome]} · 版本 {skill.revision.slice(0, 12)}</span>) : trace.context.loadedSkills?.map(skill => <span key={skill} className="rounded bg-[hsl(var(--accent-soft))] px-1.5 py-0.5 text-[8px] text-[hsl(var(--accent))]">Skill · {skill}</span>)}</div>
              </div>}
              {trace.tools.length > 0 && <div className="flex flex-wrap gap-1">{trace.tools.map(tool => <span key={tool} className="inline-flex items-center gap-1 rounded border border-[hsl(var(--border-subtle))] px-1.5 py-0.5 text-[8px]"><Wrench className="size-2.5"/>{tool}</span>)}</div>}
              <div className="rounded-md border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-app))] p-1.5">
                <div className="mb-1 px-1.5 text-[9px] font-semibold text-[hsl(var(--text-secondary))]">调用链 · 点 span 查看明细</div>
                <SpanCallTree
                  spans={trace.spans}
                  rootStartedAt={trace.startedAt}
                  totalMs={trace.durationMs ?? maxSpanDuration}
                  selectedSpanId={open ? selectedSpanId : undefined}
                  onSelectSpan={(spanId) => setSelectedSpanId(spanId === selectedSpanId ? undefined : spanId)}
                />
              </div>
              {/* 单 span payload 下钻浮层 */}
              {open && selectedSpanId && (() => {
                const span = trace.spans.find((s) => s.span_id === selectedSpanId);
                const payloads = spanPayloads?.[selectedSpanId];
                return span ? <div className="rounded-md border border-[hsl(var(--accent)/0.4)] bg-[hsl(var(--bg-app))] p-2">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-[9px] font-semibold text-[hsl(var(--text-secondary))]">{span.kind === 'tool' ? (String(span.parsedAttributes?.['gen_ai.tool.name'] ?? span.name)) : span.name} · {span.kind}</div>
                    {Boolean(span.parsedAttributes?.['gen_ai.tool.call.id']) && <span className="font-mono text-[8px] text-[hsl(var(--text-tertiary))]">callId {String(span.parsedAttributes?.['gen_ai.tool.call.id'])}</span>}
                  </div>
                  {!payloads && <div className="text-[9px] text-[hsl(var(--text-tertiary))]">加载明细…</div>}
                  {payloads && payloads.length === 0 && <div className="text-[9px] text-[hsl(var(--text-tertiary))]">该 span 无明细 payload</div>}
                  {payloads?.map((payload) => <div key={`${payload.role}:${payload.seq}`} className="mb-1.5 last:mb-0">
                    <div className="flex items-center gap-1.5 text-[8px] font-semibold text-[hsl(var(--text-secondary))]"><span>{payloadLabel(payload.role)}</span>{Boolean(payload.truncated) && <span className="rounded bg-amber-500/10 px-1 text-[7px] text-amber-600">已截断</span>}</div>
                    <pre className="mt-0.5 whitespace-pre-wrap break-words rounded border border-[hsl(var(--border-subtle))] bg-[hsl(var(--bg-muted))] p-1.5 text-[8px] leading-relaxed text-[hsl(var(--text-secondary))]">{payload.content}</pre>
                  </div>)}
                </div> : null;
              })()}
              <details><summary className="cursor-pointer text-[8px] text-[hsl(var(--text-tertiary))]">技术标识</summary><div className="mt-1 break-all font-mono text-[8px] text-[hsl(var(--text-tertiary))]">trace {trace.traceId}<br/>invocation {trace.invocationId ?? '—'}</div></details>
            </div>}
          </article>;
        })}
      </section>
    </>}
    {!snapshot && !error && <div className="flex items-center justify-center gap-2 p-8 text-[10px] text-[hsl(var(--text-tertiary))]"><Activity className="size-4 animate-pulse"/>正在加载调试数据</div>}
  </div>;
}
