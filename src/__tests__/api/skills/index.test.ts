import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import handler from '@/pages/api/skills/index';
import detailHandler from '@/pages/api/skills/[id]';

beforeEach(() => { setTestDb(createTestDb()); resetSeq(); });
afterEach(() => { resetDb(); });

describe('GET /api/skills', () => {
  it('returns empty list', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual([]);
  });
});

describe('POST /api/skills', () => {
  it('creates a skill', async () => {
    const req = mockReq('POST', { name: 'code-review', description: 'Code review', content: '# Review\nCheck.' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.name).toBe('code-review');
    // Verify in list
    const listRes = mockRes();
    await handler(mockReq('GET'), listRes);
    expect(listRes._json).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    await handler(mockReq('POST', { name: 'dup', content: 'c1' }), mockRes());
    const res = mockRes();
    await handler(mockReq('POST', { name: 'dup', content: 'c2' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('creates skill with files', async () => {
    const req = mockReq('POST', { name: 'with-files', content: 'instructions', files: [{ path: 'check.md', content: 'checklist' }] });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.fileCount).toBe(1);
  });

  it('rejects missing name or content', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { content: 'no name' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/skills/:id', () => {
  it('returns skill with files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'detail', content: 'c', files: [{ path: 'ref.md', content: 'reference' }] }), createRes);
    const req = mockReq('GET', undefined, { id: createRes._json.id });
    const res = mockRes();
    await detailHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.files).toHaveLength(1);
  });

  it('returns 404 for missing skill', async () => {
    const res = mockRes();
    await detailHandler(mockReq('GET', undefined, { id: 'nonexistent' }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/skills/:id', () => {
  it('updates and replaces files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'update', content: 'old', files: [{ path: 'old.md', content: 'old' }] }), createRes);
    const id = createRes._json.id;
    const res = mockRes();
    await detailHandler(mockReq('PATCH', { description: 'new', files: [{ path: 'new.md', content: 'new' }] }, { id }), res);
    expect(res.statusCode).toBe(200);
    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes._json.files).toHaveLength(1);
    expect(getRes._json.files[0].path).toBe('new.md');
  });
});

describe('DELETE /api/skills/:id', () => {
  it('deletes a skill', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'delete', content: 'c' }), createRes);
    const id = createRes._json.id;
    const res = mockRes();
    await detailHandler(mockReq('DELETE', undefined, { id }), res);
    expect(res.statusCode).toBe(200);
    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes.statusCode).toBe(404);
  });
});
