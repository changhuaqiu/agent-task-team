// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectObservabilityPanel } from '@/components/project/ProjectObservabilityPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('ProjectObservabilityPanel', () => {
  it('renders summary, agent workflow, context skills and tool waterfall', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      generatedAt: '2026-07-16T00:00:00Z', summary: { traceCount: 1, agentCount: 1, toolCallCount: 1, failedTraceCount: 0, totalTokens: 15, averageDurationMs: 1200 },
      agents: [{ agentId: 'planner', traceCount: 1, toolCallCount: 1, failedTraceCount: 0 }],
      workflow: { agentEdges: [{ fromAgentId: 'planner', toAgentId: 'reviewer', count: 1 }] },
      traces: [{ traceId: 'a'.repeat(32), invocationId: 'inv-1', agentId: 'planner', status: 'ok', startedAt: '2026-07-16T00:00:00Z', durationMs: 1200, engine: 'claude', totalTokens: 15, tools: ['Read'], context: { scenario: 'iterate', tokensUsed: 100, tokensBudget: 1000, saturation: .1, loadedSkills: ['review'] }, spans: [{ span_id: 'b'.repeat(16), parent_span_id: null, name: 'agent.invoke', kind: 'agent', status: 'ok', started_at: '2026-07-16T00:00:00Z', durationMs: 1200, parsedAttributes: {} }] }],
    }) })) as unknown as typeof fetch);
    render(<ProjectObservabilityPanel conversationId="conv-obs" />);
    await waitFor(() => expect(screen.getByText('planner → reviewer · 1')).toBeDefined());
    fireEvent.click(screen.getByText('planner'));
    expect(screen.getByText('Skill · review')).toBeDefined(); expect(screen.getByText('Read')).toBeDefined(); expect(screen.getByText(/上下文 · iterate/)).toBeDefined();
  });
});
