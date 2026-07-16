import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { generateTraceId, observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { spanPayloadRepo } from '@/server/repositories/span-payload-repo';
import handler from '@/pages/api/observability/span-payload';

function response() {
  const res: any = { statusCode: 200, body: undefined, headers: {}, status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
  res.setHeader.mockImplementation((key: string, value: unknown) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-a', title: 'A' }); conversationRepo.create({ id: 'conv-b', title: 'B' }); });
afterEach(() => resetDb());

describe('/api/observability/span-payload', () => {
  it('returns payload only inside the owning conversation scope', () => {
    const span = observationSpanRepo.start({ traceId: generateTraceId(), name: 'agent.invoke', kind: 'agent', conversationId: 'conv-a' });
    spanPayloadRepo.put(span.span_id, 'assembled_prompt', 'hello');
    const ok = response(); handler({ method: 'GET', query: { conversationId: 'conv-a', spanId: span.span_id } } as unknown as NextApiRequest, ok as NextApiResponse);
    expect(ok.statusCode).toBe(200); expect(ok.body.payloads[0].content).toBe('hello'); expect(ok.headers['Cache-Control']).toBe('no-store');
    const crossProject = response(); handler({ method: 'GET', query: { conversationId: 'conv-b', spanId: span.span_id } } as unknown as NextApiRequest, crossProject as NextApiResponse);
    expect(crossProject.statusCode).toBe(404);
  });
});
