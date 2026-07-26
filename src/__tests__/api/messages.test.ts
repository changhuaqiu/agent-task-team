import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/messages';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { resetSeq } from '@/server/repositories/sortable-id';

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  res.end.mockImplementation(() => res);
  res.setHeader.mockImplementation((key: string, value: unknown) => {
    res.headers[key] = value;
    return res;
  });
  return res;
}

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'project-a', title: 'A' });
  conversationRepo.create({ id: 'project-b', title: 'B' });
});

afterEach(() => {
  resetDb();
});

describe('GET /api/messages', () => {
  it('returns a no-store durable snapshot scoped to one project', () => {
    messageRepo.append({
      conversationId: 'project-a',
      senderType: 'agent',
      senderId: 'mario',
      content: 'durable A',
      invocationId: 'inv-a',
    });
    messageRepo.append({
      conversationId: 'project-b',
      senderType: 'agent',
      senderId: 'luigi',
      content: 'must not leak',
    });
    const res = response();

    handler(
      { method: 'GET', query: { conversationId: 'project-a' } } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.body).toEqual({
      messages: [expect.objectContaining({
        conversation_id: 'project-a',
        content: 'durable A',
        invocation_id: 'inv-a',
      })],
    });
  });

  it('returns the newest bounded window for long conversations', () => {
    for (let index = 0; index < 1001; index += 1) {
      messageRepo.append({
        conversationId: 'project-a',
        senderType: 'agent',
        senderId: 'mario',
        content: `message-${index}`,
      });
    }
    const res = response();

    handler(
      { method: 'GET', query: { conversationId: 'project-a' } } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );

    const messages = (res.body as { messages: Array<{ content: string }> }).messages;
    expect(messages).toHaveLength(1000);
    expect(messages[0].content).toBe('message-1');
    expect(messages.at(-1)?.content).toBe('message-1000');
  });

  it('rejects an empty project id', () => {
    const res = response();
    handler(
      { method: 'GET', query: {} } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(400);
  });

  it('rejects mutation methods', () => {
    const res = response();
    handler(
      { method: 'POST', query: {} } as unknown as NextApiRequest,
      res as unknown as NextApiResponse,
    );
    expect(res.statusCode).toBe(405);
    expect(res.end).toHaveBeenCalled();
  });
});
