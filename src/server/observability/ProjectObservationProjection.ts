import { getDb } from '../db';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { observationSpanRepo, type ObservationSpanRow } from '../repositories/observation-span-repo';

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function durationMs(span: ObservationSpanRow): number | undefined {
  if (!span.ended_at) return undefined;
  return Math.max(0, new Date(span.ended_at).getTime() - new Date(span.started_at).getTime());
}

function tokenTotal(value: string | null): number {
  const usage = parseJson<Record<string, unknown>>(value, {});
  return Object.entries(usage).reduce((sum, [key, item]) => {
    if (!/token/i.test(key) || typeof item !== 'number') return sum;
    return /total/i.test(key) ? Math.max(sum, item) : sum + item;
  }, 0);
}

export interface ProjectObservationSnapshot {
  conversationId: string;
  generatedAt: string;
  summary: {
    traceCount: number;
    invocationCount: number;
    agentCount: number;
    toolCallCount: number;
    failedTraceCount: number;
    totalTokens: number;
    averageDurationMs: number;
  };
  agents: Array<{
    agentId: string;
    traceCount: number;
    toolCallCount: number;
    failedTraceCount: number;
    lastActiveAt: string;
  }>;
  traces: Array<{
    traceId: string;
    rootSpanId: string;
    agentId?: string;
    taskId?: string;
    invocationId?: string;
    chainId?: string;
    passId?: string;
    status: string;
    startedAt: string;
    endedAt?: string;
    durationMs?: number;
    engine?: string;
    totalTokens: number;
    context?: Record<string, unknown>;
    tools: string[];
    spans: Array<ObservationSpanRow & { parsedAttributes: Record<string, unknown>; durationMs?: number }>;
  }>;
  workflow: {
    tasks: ReturnType<typeof taskGraphRepo.getGraph>['tasks'];
    taskEdges: ReturnType<typeof taskGraphRepo.getGraph>['edges'];
    agentEdges: Array<{ fromAgentId: string; toAgentId: string; count: number; chainIds: string[]; passIds: string[] }>;
  };
}

type InvocationUsageRow = { id: string; token_usage: string | null; usage: string | null };
type RawAgentEdge = { from_agent_id: string; to_agent_id: string; chain_id: string; pass_id: string | null };

export const projectObservationProjection = {
  build(conversationId: string, limit = 50): ProjectObservationSnapshot {
    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const spans = observationSpanRepo.listByConversation(conversationId, 2_000);
    const traceGroups = new Map<string, ObservationSpanRow[]>();
    for (const span of spans) traceGroups.set(span.trace_id, [...(traceGroups.get(span.trace_id) ?? []), span]);

    const invocationUsage = new Map((getDb().prepare(`SELECT id, token_usage, usage FROM invocation
      WHERE conversation_id = ?`).all(conversationId) as InvocationUsageRow[]).map(row => [row.id, row]));

    const traces = Array.from(traceGroups.entries()).map(([traceId, traceSpans]) => {
      const ordered = [...traceSpans].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.span_id.localeCompare(b.span_id));
      const root = ordered.find(span => !span.parent_span_id && span.kind === 'agent') ?? ordered[0];
      const contextSpan = ordered.find(span => span.kind === 'context');
      const rootAttributes = parseJson<Record<string, unknown>>(root.attributes, {});
      const contextAttributes = parseJson<Record<string, unknown>>(contextSpan?.attributes, {});
      const usage = root.invocation_id ? invocationUsage.get(root.invocation_id) : undefined;
      const tools = ordered.filter(span => span.kind === 'tool').map(span => {
        const attributes = parseJson<Record<string, unknown>>(span.attributes, {});
        return String(attributes['gen_ai.tool.name'] ?? span.name);
      });
      return {
        traceId,
        rootSpanId: root.span_id,
        agentId: root.agent_id ?? undefined,
        taskId: root.task_id ?? undefined,
        invocationId: root.invocation_id ?? undefined,
        chainId: root.chain_id ?? undefined,
        passId: root.pass_id ?? undefined,
        status: root.status,
        startedAt: root.started_at,
        endedAt: root.ended_at ?? undefined,
        durationMs: durationMs(root),
        engine: typeof rootAttributes['ath.runtime.engine'] === 'string' ? rootAttributes['ath.runtime.engine'] : undefined,
        totalTokens: tokenTotal(usage?.token_usage ?? usage?.usage ?? null),
        context: contextAttributes.report && typeof contextAttributes.report === 'object'
          ? contextAttributes.report as Record<string, unknown> : undefined,
        tools: Array.from(new Set(tools)),
        spans: ordered.map(span => ({ ...span, parsedAttributes: parseJson(span.attributes, {}), durationMs: durationMs(span) })),
      };
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, cappedLimit);

    const agentMap = new Map<string, ProjectObservationSnapshot['agents'][number]>();
    for (const trace of traces) {
      if (!trace.agentId) continue;
      const current = agentMap.get(trace.agentId) ?? {
        agentId: trace.agentId, traceCount: 0, toolCallCount: 0, failedTraceCount: 0, lastActiveAt: trace.startedAt,
      };
      current.traceCount += 1;
      current.toolCallCount += trace.spans.filter(span => span.kind === 'tool').length;
      if (trace.status === 'error') current.failedTraceCount += 1;
      if (trace.startedAt > current.lastActiveAt) current.lastActiveAt = trace.startedAt;
      agentMap.set(trace.agentId, current);
    }

    const rawEdges = getDb().prepare(`
      SELECT p.from_holder_id AS from_agent_id, p.to_agent_id, p.chain_id, p.id AS pass_id
      FROM a2a_pass p JOIN a2a_possession_chain c ON c.id = p.chain_id
      WHERE c.conversation_id = ?
      UNION ALL
      SELECT w.requested_by AS from_agent_id, w.agent_id AS to_agent_id, w.chain_id, NULL AS pass_id
      FROM chain_worklist w JOIN invocation_chain c ON c.id = w.chain_id
      WHERE c.conversation_id = ?
    `).all(conversationId, conversationId) as RawAgentEdge[];
    const edgeMap = new Map<string, ProjectObservationSnapshot['workflow']['agentEdges'][number]>();
    for (const edge of rawEdges) {
      if (!edge.from_agent_id || !edge.to_agent_id || edge.from_agent_id === edge.to_agent_id) continue;
      const key = `${edge.from_agent_id}\0${edge.to_agent_id}`;
      const current = edgeMap.get(key) ?? { fromAgentId: edge.from_agent_id, toAgentId: edge.to_agent_id, count: 0, chainIds: [], passIds: [] };
      current.count += 1;
      if (!current.chainIds.includes(edge.chain_id)) current.chainIds.push(edge.chain_id);
      if (edge.pass_id && !current.passIds.includes(edge.pass_id)) current.passIds.push(edge.pass_id);
      edgeMap.set(key, current);
    }

    const graph = taskGraphRepo.getGraph(conversationId);
    const durations = traces.map(trace => trace.durationMs).filter((value): value is number => value !== undefined);
    return {
      conversationId,
      generatedAt: new Date().toISOString(),
      summary: {
        traceCount: traces.length,
        invocationCount: new Set(traces.map(trace => trace.invocationId).filter(Boolean)).size,
        agentCount: agentMap.size,
        toolCallCount: traces.reduce((sum, trace) => sum + trace.spans.filter(span => span.kind === 'tool').length, 0),
        failedTraceCount: traces.filter(trace => trace.status === 'error').length,
        totalTokens: traces.reduce((sum, trace) => sum + trace.totalTokens, 0),
        averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      },
      agents: Array.from(agentMap.values()).sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)),
      traces,
      workflow: { tasks: graph.tasks, taskEdges: graph.edges, agentEdges: Array.from(edgeMap.values()) },
    };
  },
};
