import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { generateTraceId, observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { spanPayloadRepo } from '@/server/repositories/span-payload-repo';
import { isThinkingCaptureEnabled } from '@/server/observability/redaction';

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('spanPayloadRepo', () => {
  it('redacts secrets, preserves full ordinary content and marks byte truncation', () => {
    const span = observationSpanRepo.start({ traceId: generateTraceId(), name: 'agent.invoke', kind: 'agent', conversationId: 'conv-obs' });
    const payload = spanPayloadRepo.put(
      span.span_id,
      'system_prompt',
      `api_key=secret-value\n${'中'.repeat(100_000)}`,
    )!;
    expect(payload.content).toContain('api_key=[REDACTED]');
    expect(payload.content).not.toContain('secret-value');
    expect(payload.truncated).toBe(1);
    expect(payload.byte_size).toBeLessThanOrEqual(256 * 1024);
    expect(spanPayloadRepo.listBySpan(span.span_id)).toEqual([payload]);
  });

  it('defaults thinking capture on and accepts an exact case-insensitive false opt-out', () => {
    expect(isThinkingCaptureEnabled(undefined)).toBe(true);
    expect(isThinkingCaptureEnabled(' FALSE ')).toBe(false);
    expect(isThinkingCaptureEnabled('0')).toBe(true);
  });
});
