// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectObservabilityPanel } from '@/components/project/ProjectObservabilityPanel';

vi.mock('@/components/project/AgentChainGraph', () => ({
  AgentChainGraph: ({ chains }: { chains: Array<{ nodes: Array<{ agentId: string }> }> }) => <div data-testid="agent-chain-graph">{chains.flatMap(chain => chain.nodes).map(node => node.agentId).join(' → ')}</div>,
}));

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProjectObservabilityPanel', () => {
  it('renders summary, agent workflow, context skills and tool waterfall', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      generatedAt: '2026-07-16T00:00:00Z', summary: { traceCount: 1, agentCount: 1, toolCallCount: 1, failedTraceCount: 0, totalTokens: 15, averageDurationMs: 1200 },
      agents: [{ agentId: 'planner', traceCount: 1, toolCallCount: 1, failedTraceCount: 0 }],
      workflow: { agentEdges: [{ fromAgentId: 'planner', toAgentId: 'reviewer', count: 1 }], taskChains: [{ taskId: 'TASK-1', chainIds: ['chain-1'], agentIds: ['planner', 'reviewer'], traceIds: ['a'.repeat(32)] }] },
      chains: [{ chainId: 'chain-1', status: 'active', taskIds: ['TASK-1'], nodes: [{ id: 'planner', agentId: 'planner' }, { id: 'reviewer', agentId: 'reviewer' }], edges: [{ id: 'e1', source: 'planner', target: 'reviewer' }] }],
      traces: [{ traceId: 'a'.repeat(32), invocationId: 'inv-1', agentId: 'planner', status: 'ok', startedAt: '2026-07-16T00:00:00Z', durationMs: 1200, engine: 'claude', totalTokens: 15, tools: ['Read'], context: { scenario: 'iterate', tokensUsed: 100, tokensBudget: 1000, saturation: .1, snapshotId: 'ctx_1234567890abcdef', fragmentCount: 7, missingRequired: [], omissions: [{ fragmentId: 'history', producer: 'legacy', reason: 'scenario_omitted', required: false }], loadedSkills: ['review'], eligibleSkills: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456' }], activatedSkills: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456', activationReason: 'agent_binding' }], skillDecisions: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456', outcome: 'loaded', reasonCode: 'compiled_into_context' }] }, spans: [{ span_id: 'b'.repeat(16), parent_span_id: null, name: 'agent.invoke', kind: 'agent', status: 'ok', started_at: '2026-07-16T00:00:00Z', durationMs: 1200, parsedAttributes: {} }] }],
    }) })) as unknown as typeof fetch);
    render(<ProjectObservabilityPanel conversationId="conv-obs" />);
    await waitFor(() => expect(screen.getByTestId('agent-chain-graph').textContent).toBe('planner → reviewer'));
    expect(screen.getByText('Task × Chain')).toBeDefined();
    fireEvent.click(screen.getAllByText('planner').at(-1)!);
    expect(screen.getByText(/已绑定 1 · 本轮激活 1 · 已编入 1/)).toBeDefined(); expect(screen.getByText(/Skill · review · 已加载/)).toBeDefined(); expect(screen.getByText('Read')).toBeDefined(); expect(screen.getByText(/上下文 · iterate/)).toBeDefined();
    expect(screen.getByText(/Snapshot ctx_1234567890a/)).toBeDefined();
    expect(screen.getByText('已加载 7')).toBeDefined();
    expect(screen.getByText('必需缺失 0')).toBeDefined();
    expect(screen.getByText('省略 1')).toBeDefined();
  });

  it('renders a failed Skill decision from a context compilation trace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      generatedAt: '2026-07-18T00:00:00Z',
      summary: { traceCount: 1, agentCount: 1, toolCallCount: 0, failedTraceCount: 1, totalTokens: 0, averageDurationMs: 0 },
      agents: [{ agentId: 'peach', traceCount: 1, toolCallCount: 0, failedTraceCount: 1 }],
      workflow: { agentEdges: [], taskChains: [] },
      chains: [],
      traces: [{
        traceId: 'c'.repeat(32), agentId: 'peach', status: 'error', startedAt: '2026-07-18T00:00:00Z', totalTokens: 0, tools: [],
        context: {
          scenario: 'init', tokensUsed: 0, tokensBudget: 0, saturation: 0, loadedSkills: [],
          eligibleSkills: [{ skillId: 'skill-bad', name: 'tamper-guard', revision: 'skill-rev-bad' }],
          activatedSkills: [{ skillId: 'skill-bad', name: 'tamper-guard', revision: 'skill-rev-bad', activationReason: 'agent_binding' }],
          skillDecisions: [{ skillId: 'skill-bad', name: 'tamper-guard', revision: 'skill-rev-bad', outcome: 'failed', reasonCode: 'skill_manifest_invalid' }],
        },
        spans: [{ span_id: 'd'.repeat(16), parent_span_id: null, name: 'context.compile', kind: 'context', status: 'error', started_at: '2026-07-18T00:00:00Z', parsedAttributes: {} }],
      }],
    }) })) as unknown as typeof fetch);

    render(<ProjectObservabilityPanel conversationId="conv-failed-skill" />);
    await waitFor(() => expect(screen.getAllByText('peach').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('peach').at(-1)!);
    await waitFor(() => expect(document.querySelector('[title="skill_manifest_invalid"]')).not.toBeNull());
    expect(document.querySelector('[title="skill_manifest_invalid"]')?.textContent).toContain('tamper-guard');
  });

  it('renders required-context failures from an error context trace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      generatedAt: '2026-07-19T00:00:00Z',
      summary: { traceCount: 1, agentCount: 1, toolCallCount: 0, failedTraceCount: 1, totalTokens: 0, averageDurationMs: 0 },
      agents: [{ agentId: 'luigi', traceCount: 1, toolCallCount: 0, failedTraceCount: 1 }],
      workflow: { agentEdges: [], taskChains: [] },
      chains: [],
      traces: [{
        traceId: 'e'.repeat(32), agentId: 'luigi', status: 'error', startedAt: '2026-07-19T00:00:00Z', totalTokens: 0, tools: [],
        context: {
          scenario: 'execution',
          tokensUsed: 0,
          tokensBudget: 0,
          saturation: 0,
          snapshotId: 'ctx_failed_trace123',
          fragmentCount: 0,
          missingRequired: ['delivery-goal:run-1'],
          omissions: [{ fragmentId: 'delivery-goal:run-1', producer: 'autonomous-delivery', reason: 'budget_trimmed', required: true }],
        },
        spans: [{ span_id: 'f'.repeat(16), parent_span_id: null, name: 'context.compile', kind: 'context', status: 'error', started_at: '2026-07-19T00:00:00Z', parsedAttributes: {} }],
      }],
    }) })) as unknown as typeof fetch);

    render(<ProjectObservabilityPanel conversationId="conv-required-context" />);
    await waitFor(() => expect(screen.getAllByText('luigi').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('luigi').at(-1)!);
    expect(screen.getByText('必需缺失 1')).toBeDefined();
    expect(screen.getByText('省略 1')).toBeDefined();
    expect(screen.getByText(/Snapshot ctx_failed_trace/)).toBeDefined();
  });
});
