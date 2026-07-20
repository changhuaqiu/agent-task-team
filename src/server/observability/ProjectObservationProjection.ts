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

function tokenNodeTotal(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const entries = Object.entries(value as Record<string, unknown>);
  const explicitTotal = entries.find(([key, item]) =>
    typeof item === 'number' && /(?:total.*token|token.*total)/i.test(key),
  );
  if (explicitTotal) return explicitTotal[1] as number;

  const direct = entries.reduce((sum, [key, item]) =>
    sum + (/token/i.test(key) && typeof item === 'number' ? item : 0), 0);
  const nested = entries.reduce((sum, [, item]) => sum + tokenNodeTotal(item), 0);
  return direct + nested;
}

function tokenTotal(value: string | null): number {
  return tokenNodeTotal(parseJson<Record<string, unknown>>(value, {}));
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
  chains: Array<{
    chainId: string;
    status?: string;
    taskIds: string[];
    nodes: Array<{
      id: string;
      agentId: string;
      traceId?: string;
      invocationId?: string;
      taskId?: string;
      status?: string;
      startedAt?: string;
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      fromAgentId: string;
      toAgentId: string;
      passId?: string;
      status?: string;
      reason?: string;
      eventType?: string;
      createdAt?: string;
    }>;
  }>;
  workflow: {
    tasks: ReturnType<typeof taskGraphRepo.getGraph>['tasks'];
    taskEdges: ReturnType<typeof taskGraphRepo.getGraph>['edges'];
    agentEdges: Array<{ fromAgentId: string; toAgentId: string; count: number; chainIds: string[]; passIds: string[]; auditEvents: string[] }>;
    taskChains: Array<{ taskId: string; chainIds: string[]; agentIds: string[]; traceIds: string[] }>;
  };
}

type InvocationUsageRow = { id: string; token_usage: string | null; usage: string | null };
type RawAgentEdge = {
  from_agent_id: string;
  to_agent_id: string;
  chain_id: string;
  pass_id: string | null;
  status: string | null;
  reason: string | null;
  created_at: string | null;
};
type RawAuditEvent = {
  chain_id: string | null;
  event_type: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  reason: string | null;
  created_at: string;
};

export interface ProjectObservationFilters {
  traceId?: string;
  invocationId?: string;
  agentId?: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
}

export const projectObservationProjection = {
  build(conversationId: string, limit = 50, filters: ProjectObservationFilters = {}): ProjectObservationSnapshot {
    const cappedLimit = Math.max(1, Math.min(limit, 100));
    const spans = observationSpanRepo.listByConversation(conversationId, 2_000);
    const traceGroups = new Map<string, ObservationSpanRow[]>();
    for (const span of spans) traceGroups.set(span.trace_id, [...(traceGroups.get(span.trace_id) ?? []), span]);

    const invocationUsage = new Map((getDb().prepare(`SELECT id, token_usage, usage FROM invocation
      WHERE conversation_id = ?`).all(conversationId) as InvocationUsageRow[]).map(row => [row.id, row]));

    const allTraces = Array.from(traceGroups.entries()).map(([traceId, traceSpans]) => {
      const ordered = [...traceSpans].sort((a, b) => a.started_at.localeCompare(b.started_at) || a.span_id.localeCompare(b.span_id));
      const root = ordered.find(span => !span.parent_span_id && span.kind === 'agent') ?? ordered[0];
      // Prefer the later runtime-bound snapshot over the assembly snapshot.
      // Required-context failures still expose their single assembly error span.
      const contextSpan = ordered.find(span => span.name === 'context.runtime')
        ?? ordered.find(span => span.kind === 'context');
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
    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const traces = allTraces.filter(trace =>
      (!filters.traceId || trace.traceId === filters.traceId)
      && (!filters.invocationId || trace.invocationId === filters.invocationId)
      && (!filters.agentId || trace.agentId === filters.agentId)
      && (!filters.taskId || trace.taskId === filters.taskId)
      && (!filters.chainId || trace.chainId === filters.chainId)
      && (!filters.passId || trace.passId === filters.passId),
    ).slice(0, cappedLimit);

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
      SELECT p.from_holder_id AS from_agent_id, p.to_agent_id, p.chain_id, p.id AS pass_id,
        p.status, p.reason, p.created_at
      FROM a2a_pass p JOIN a2a_possession_chain c ON c.id = p.chain_id
      WHERE c.conversation_id = ?
      UNION ALL
      SELECT w.requested_by AS from_agent_id, w.agent_id AS to_agent_id, w.chain_id, NULL AS pass_id,
        w.status, NULL AS reason, w.queued_at AS created_at
      FROM chain_worklist w JOIN invocation_chain c ON c.id = w.chain_id
      WHERE c.conversation_id = ?
    `).all(conversationId, conversationId) as RawAgentEdge[];
    const auditEvents = getDb().prepare(`SELECT chain_id, event_type, from_agent_id, to_agent_id, reason, created_at
      FROM a2a_audit_log WHERE conversation_id = ? ORDER BY created_at, id`)
      .all(conversationId) as RawAuditEvent[];
    const edgeMap = new Map<string, ProjectObservationSnapshot['workflow']['agentEdges'][number]>();
    for (const edge of rawEdges) {
      if (!edge.from_agent_id || !edge.to_agent_id || edge.from_agent_id === edge.to_agent_id) continue;
      const key = `${edge.from_agent_id}\0${edge.to_agent_id}`;
      const current = edgeMap.get(key) ?? { fromAgentId: edge.from_agent_id, toAgentId: edge.to_agent_id, count: 0, chainIds: [], passIds: [], auditEvents: [] };
      current.count += 1;
      if (!current.chainIds.includes(edge.chain_id)) current.chainIds.push(edge.chain_id);
      if (edge.pass_id && !current.passIds.includes(edge.pass_id)) current.passIds.push(edge.pass_id);
      for (const audit of auditEvents) {
        if (audit.chain_id !== edge.chain_id || audit.from_agent_id !== edge.from_agent_id || audit.to_agent_id !== edge.to_agent_id) continue;
        if (!current.auditEvents.includes(audit.event_type)) current.auditEvents.push(audit.event_type);
      }
      edgeMap.set(key, current);
    }

    const chainIds = new Set<string>([
      ...rawEdges.map(edge => edge.chain_id),
      ...allTraces.map(trace => trace.chainId).filter((value): value is string => Boolean(value)),
      ...auditEvents.map(event => event.chain_id).filter((value): value is string => Boolean(value)),
    ]);
    const chains: ProjectObservationSnapshot['chains'] = Array.from(chainIds).map(chainId => {
      const chainTraces = allTraces.filter(trace => trace.chainId === chainId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      const nodes: ProjectObservationSnapshot['chains'][number]['nodes'] = chainTraces.map(trace => ({
        id: `trace:${trace.traceId}`,
        agentId: trace.agentId ?? 'agent',
        traceId: trace.traceId,
        invocationId: trace.invocationId,
        taskId: trace.taskId,
        status: trace.status,
        startedAt: trace.startedAt,
      }));
      const nodeForAgent = (agentId: string, targetAgentId?: string) => {
        const candidates = nodes.filter(node => node.agentId === agentId);
        if (candidates.length) return targetAgentId ? candidates[candidates.length - 1] : candidates[0];
        const id = `actor:${chainId}:${agentId}`;
        const node = { id, agentId };
        nodes.push(node);
        return node;
      };
      const edges = rawEdges.filter(edge => edge.chain_id === chainId).map((edge, index) => {
        const targetByPass = edge.pass_id
          ? nodes.find(node => node.traceId && allTraces.find(trace => trace.traceId === node.traceId)?.passId === edge.pass_id)
          : undefined;
        const target = targetByPass ?? nodes.find(node => node.agentId === edge.to_agent_id) ?? nodeForAgent(edge.to_agent_id);
        const sourceCandidates = nodes.filter(node => node.agentId === edge.from_agent_id && node.id !== target.id);
        const source = sourceCandidates[sourceCandidates.length - 1] ?? nodeForAgent(edge.from_agent_id, edge.to_agent_id);
        const audit = auditEvents.find(item => item.chain_id === chainId
          && item.from_agent_id === edge.from_agent_id && item.to_agent_id === edge.to_agent_id);
        return {
          id: edge.pass_id ? `pass:${edge.pass_id}` : `work:${chainId}:${index}`,
          source: source.id,
          target: target.id,
          fromAgentId: edge.from_agent_id,
          toAgentId: edge.to_agent_id,
          passId: edge.pass_id ?? undefined,
          status: edge.status ?? undefined,
          reason: edge.reason ?? audit?.reason ?? undefined,
          eventType: audit?.event_type,
          createdAt: edge.created_at ?? audit?.created_at,
        };
      });
      const taskIds = Array.from(new Set(chainTraces.map(trace => trace.taskId).filter((value): value is string => Boolean(value))));
      const status = edges.some(edge => edge.status === 'blocked' || edge.status === 'timeout') ? 'blocked'
        : edges.length && edges.every(edge => edge.status === 'completed' || edge.status === 'done') ? 'completed' : 'active';
      return { chainId, status, taskIds, nodes, edges };
    }).sort((a, b) => a.chainId.localeCompare(b.chainId));

    const taskChainMap = new Map<string, ProjectObservationSnapshot['workflow']['taskChains'][number]>();
    for (const chain of chains) {
      for (const taskId of chain.taskIds) {
        const current = taskChainMap.get(taskId) ?? { taskId, chainIds: [], agentIds: [], traceIds: [] };
        if (!current.chainIds.includes(chain.chainId)) current.chainIds.push(chain.chainId);
        for (const node of chain.nodes) {
          if (!current.agentIds.includes(node.agentId)) current.agentIds.push(node.agentId);
          if (node.traceId && !current.traceIds.includes(node.traceId)) current.traceIds.push(node.traceId);
        }
        taskChainMap.set(taskId, current);
      }
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
      chains,
      workflow: {
        tasks: graph.tasks,
        taskEdges: graph.edges,
        agentEdges: Array.from(edgeMap.values()),
        taskChains: Array.from(taskChainMap.values()),
      },
    };
  },
};
