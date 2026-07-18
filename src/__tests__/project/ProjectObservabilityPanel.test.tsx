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
      traces: [{ traceId: 'a'.repeat(32), invocationId: 'inv-1', agentId: 'planner', status: 'ok', startedAt: '2026-07-16T00:00:00Z', durationMs: 1200, engine: 'claude', totalTokens: 15, tools: ['Read'], context: { scenario: 'iterate', tokensUsed: 100, tokensBudget: 1000, saturation: .1, loadedSkills: ['review'], eligibleSkills: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456' }], activatedSkills: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456', activationReason: 'agent_binding' }], skillDecisions: [{ skillId: 'skill-1', name: 'review', revision: 'skill-rev-123456', outcome: 'loaded', reasonCode: 'compiled_into_context' }] }, spans: [{ span_id: 'b'.repeat(16), parent_span_id: null, name: 'agent.invoke', kind: 'agent', status: 'ok', started_at: '2026-07-16T00:00:00Z', durationMs: 1200, parsedAttributes: {} }] }],
    }) })) as unknown as typeof fetch);
    render(<ProjectObservabilityPanel conversationId="conv-obs" />);
    await waitFor(() => expect(screen.getByTestId('agent-chain-graph').textContent).toBe('planner → reviewer'));
    expect(screen.getByText('Task × Chain')).toBeDefined();
    fireEvent.click(screen.getAllByText('planner').at(-1)!);
    expect(screen.getByText(/已绑定 1 · 本轮激活 1 · 已编入 1/)).toBeDefined(); expect(screen.getByText(/Skill · review · 已加载/)).toBeDefined(); expect(screen.getByText('Read')).toBeDefined(); expect(screen.getByText(/上下文 · iterate/)).toBeDefined();
  });
});
