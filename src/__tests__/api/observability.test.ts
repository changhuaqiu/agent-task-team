import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import handler from '@/pages/api/observability';
import type { NextApiRequest, NextApiResponse } from 'next';

type MockResponse = { statusCode: number; body: unknown; headers: Record<string, unknown>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> };
function response(): MockResponse {
  const res: MockResponse = { statusCode: 200, body: undefined, headers: {}, status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockImplementation((code: number) => { res.statusCode = code; return res; });
  res.json.mockImplementation((body: unknown) => { res.body = body; return res; });
  res.setHeader.mockImplementation((key: string, value: unknown) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => { setTestDb(createTestDb()); conversationRepo.create({ id: 'conv-obs', title: 'Observability' }); });
afterEach(() => resetDb());

describe('/api/observability', () => {
  it('returns an empty project snapshot before the first turn', () => {
    const res = response(); handler({ method: 'GET', query: { conversationId: 'conv-obs' } } as unknown as NextApiRequest, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(200); expect((res.body as { summary: { traceCount: number } }).summary.traceCount).toBe(0); expect(res.headers['Cache-Control']).toBe('no-store');
  });
  it('validates query input', () => {
    const res = response(); handler({ method: 'GET', query: {} } as unknown as NextApiRequest, res as unknown as NextApiResponse); expect(res.statusCode).toBe(400);
  });
});
