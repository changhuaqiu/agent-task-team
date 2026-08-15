import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/phases';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { listPhasesByConversation, upsertPhase } from '@/server/db/phaseQueries';

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

function request(
  method: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
) {
  return {
    method,
    query: options.query ?? {},
    body: Object.hasOwn(options, 'body') ? options.body : {},
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  setTestDb(createTestDb());
  conversationRepo.create({ id: 'project-a', title: 'A' });
  conversationRepo.create({ id: 'project-b', title: 'B' });
});

afterEach(() => {
  resetDb();
});

describe('/api/phases', () => {
  it('creates, lists, updates, and deletes phases through one interface', async () => {
    const createdAt = '2026-08-15T00:00:00.000Z';
    const phase = {
      id: 'phase-a',
      conversationId: 'project-a',
      title: 'Plan',
      description: 'Plan the work',
      order: 1,
      status: 'planned' as const,
      createdAt,
      updatedAt: createdAt,
    };

    const createRes = response();
    await handler(request('POST', { body: phase }), createRes as unknown as NextApiResponse);
    expect(createRes.statusCode).toBe(200);
    expect(createRes.body).toMatchObject({
      ...phase,
      updatedAt: expect.any(String),
    });

    upsertPhase({ ...phase, id: 'phase-b', conversationId: 'project-b', order: 0 });
    const listRes = response();
    await handler(
      request('GET', { query: { conversationId: 'project-a' } }),
      listRes as unknown as NextApiResponse,
    );
    expect(listRes.body).toEqual([expect.objectContaining({ id: 'phase-a' })]);

    const updateRes = response();
    await handler(
      request('POST', { body: { ...phase, title: 'Plan carefully', status: 'active' } }),
      updateRes as unknown as NextApiResponse,
    );
    expect(updateRes.body).toMatchObject({ id: 'phase-a', title: 'Plan carefully', status: 'active' });

    const deleteRes = response();
    await handler(
      request('DELETE', { query: { id: 'phase-a' } }),
      deleteRes as unknown as NextApiResponse,
    );
    expect(deleteRes.body).toEqual({ ok: true });
    expect(listPhasesByConversation('project-a').some((item) => item.id === 'phase-a')).toBe(false);
  });

  it('rejects incomplete requests and unsupported methods', async () => {
    for (const [req, status] of [
      [request('GET'), 400],
      [request('POST', { body: { id: 'phase-a' } }), 400],
      [request('POST', { body: null }), 400],
      [request('POST', { body: [] }), 400],
      [request('POST', { body: {
        id: 'phase-a',
        conversationId: 'project-a',
        title: 'Plan',
        description: 42,
        order: 0,
        status: 'planned',
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      } }), 400],
      [request('DELETE'), 400],
      [request('PATCH'), 405],
    ] as const) {
      const res = response();
      await handler(req, res as unknown as NextApiResponse);
      expect(res.statusCode).toBe(status);
    }
  });
});
