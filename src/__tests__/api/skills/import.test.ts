import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import handler from '@/pages/api/skills/import';

beforeEach(() => { setTestDb(createTestDb()); resetSeq(); });
afterEach(() => { resetDb(); });

describe('POST /api/skills/import', () => {
  it('rejects missing source', async () => {
    const req = mockReq('POST', {});
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects non-string source', async () => {
    const req = mockReq('POST', { source: 123 });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid URL', async () => {
    const req = mockReq('POST', { source: 'not-a-url' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res._json.error).toContain('Invalid URL');
  });

  it('rejects non-POST methods', async () => {
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const req = mockReq(method, {});
      const res = mockRes();
      await handler(req, res);
      expect(res.statusCode).toBe(405);
    }
  });

  it('rejects URL with unsupported protocol', async () => {
    const req = mockReq('POST', { source: 'ftp://example.com/repo' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(500);
    expect(res._json.error).toContain('Invalid URL');
  });
});
