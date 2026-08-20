// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AgentObservabilityDrawerHost } from '@/components/project/AgentObservabilityDrawerHost';
import { openAgentObservabilityDrawer } from '@/components/project/agent-observability-controller';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('AgentObservabilityDrawer', () => {
  it('loads an exact invocation and lazily renders completion and thinking payloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('span-payload')) return { ok: true, json: async () => ({ payloads: [
        { role: 'completion', seq: 0, content: 'final answer', byte_size: 12, truncated: 0 },
        { role: 'thinking', seq: 0, content: 'runtime summary', byte_size: 15, truncated: 0 },
      ] }) } as Response;
      return { ok: true, json: async () => ({ traces: [{
        traceId: 'trace-1', invocationId: 'inv-1', agentId: 'reviewer', startedAt: '2026-07-16T00:00:00.000Z', durationMs: 100, totalTokens: 7,
        spans: [{ span_id: 'message-1', kind: 'message', name: 'agent.message', status: 'ok', started_at: '2026-07-16T00:00:00.010Z', durationMs: 80, parsedAttributes: {} }],
      }] }) } as Response;
    }));
    render(<AgentObservabilityDrawerHost />);
    openAgentObservabilityDrawer({ conversationId: 'conv-obs', invocationId: 'inv-1' });
    await waitFor(() => expect(screen.getByText('Agent 调用详情')).toBeDefined());
    fireEvent.click(await screen.findByText('模型回复'));
    expect(await screen.findByText('final answer')).toBeDefined();
    expect(screen.getByText(/thinking summary/)).toBeDefined();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(call => String(call[0]).includes('conversationId=conv-obs') && String(call[0]).includes('invocationId=inv-1'))).toBe(true);
  });
});
