import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import { generateSpanId, generateTraceId, observationSpanRepo } from '@/server/repositories/observation-span-repo';

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('observationSpanRepo', () => {
  it('stores an OTel-shaped parent/child trace and closes open invocation spans', () => {
    invocationRepo.create({ id: 'inv-obs', conversation_id: 'conv-obs', agent_id: 'reviewer' });
    const traceId = generateTraceId();
    const root = observationSpanRepo.start({ traceId, spanId: generateSpanId(), name: 'agent.invoke', kind: 'agent', conversationId: 'conv-obs', agentId: 'reviewer', invocationId: 'inv-obs' });
    observationSpanRepo.start({ traceId, parentSpanId: root.span_id, name: 'tool.execute', kind: 'tool', conversationId: 'conv-obs', agentId: 'reviewer', invocationId: 'inv-obs', attributes: { 'gen_ai.tool.name': 'Read' } });
    observationSpanRepo.finishOpenByInvocation('inv-obs', 'ok');

    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(root.span_id).toMatch(/^[0-9a-f]{16}$/);
    const spans = observationSpanRepo.listByTrace(traceId);
    expect(spans.find(span => span.kind === 'agent')).toMatchObject({ status: 'ok' });
    expect(spans.find(span => span.kind === 'tool')).toMatchObject({ status: 'ok', parent_span_id: root.span_id });
  });

  it('redacts secrets and bounds previews before persistence', () => {
    const span = observationSpanRepo.start({
      traceId: generateTraceId(), name: 'tool.execute', kind: 'tool', conversationId: 'conv-obs',
      inputPreview: `Authorization=Bearer abcdefghijklmnopqrstuvwxyz ${'x'.repeat(3_000)}`,
    });
    expect(span.input_preview).toContain('[REDACTED]');
    expect(span.input_preview!.length).toBeLessThanOrEqual(2_001);
    expect(span.input_preview).not.toContain('abcdefghijklmnopqrstuvwxyz');
  });

  it('closes a tool missing its terminal update as an error before a successful invocation finishes', () => {
    invocationRepo.create({ id: 'inv-missing-tool', conversation_id: 'conv-obs', agent_id: 'reviewer' });
    const traceId = generateTraceId();
    const root = observationSpanRepo.start({
      traceId,
      name: 'agent.invoke',
      kind: 'agent',
      conversationId: 'conv-obs',
      invocationId: 'inv-missing-tool',
    });
    const tool = observationSpanRepo.start({
      traceId,
      parentSpanId: root.span_id,
      name: 'tool.execute',
      kind: 'tool',
      conversationId: 'conv-obs',
      invocationId: 'inv-missing-tool',
      attributes: { 'gen_ai.tool.call.id': 'tool-without-terminal' },
    });

    observationSpanRepo.finishOpenToolsByInvocation(
      'inv-missing-tool',
      'acp_tool_terminal_missing',
    );
    observationSpanRepo.finishOpenByInvocation('inv-missing-tool', 'ok');

    expect(observationSpanRepo.get(tool.span_id)).toMatchObject({
      status: 'error',
      error_message: 'acp_tool_terminal_missing',
    });
    expect(JSON.parse(observationSpanRepo.get(tool.span_id)!.attributes)).toMatchObject({
      'gen_ai.tool.status': 'failed',
      'ath.error.code': 'acp_tool_terminal_missing',
    });
    expect(observationSpanRepo.get(root.span_id)).toMatchObject({ status: 'ok' });
  });
});
