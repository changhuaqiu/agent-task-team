import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '@/server/db';
import { upsertAgent } from '@/server/db/agentQueries';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import handler from '@/pages/api/human-commands';
import type { NextApiRequest, NextApiResponse } from 'next';
import type { CommandReceipt } from '@/lib/human-command';

function mockReq(method: string, body?: unknown): NextApiRequest {
  return { method, body } as NextApiRequest;
}

type MockResponseBody = { receipt?: CommandReceipt; reasonCode?: string };
type MockResponse = NextApiResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: MockResponseBody;
};

function mockRes(): MockResponse {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: {} as MockResponseBody,
    setHeader(name: string, value: string) { res.headers[name] = value; },
    status(code: number) { res.statusCode = code; return res; },
    json(body: MockResponseBody) { res.body = body; return res; },
  };
  return res as unknown as MockResponse;
}

function seedAgent() {
  upsertAgent({
    id: 'mario',
    name: 'Mario',
    roleCardId: 'developer',
    theme: 'red',
    emoji: '🍄',
    isPreset: true,
  });
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    type: 'delivery.requirement.submit',
    idempotencyKey: 'api-requirement-1',
    projectPath: 'C:/projects/api',
    deliveryId: 'delivery-api',
    actor: { type: 'user', id: 'human' },
    content: '补充验收标准',
    targetAgentIds: [],
    issuedAt: '2026-08-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('POST /api/human-commands', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({
      id: 'delivery-api',
      title: 'API Delivery',
      project_path: 'C:/projects/api',
    });
  });

  afterEach(() => resetDb());

  it('only accepts POST', () => {
    const res = mockRes();
    handler(mockReq('GET'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.Allow).toBe('POST');
  });

  it('returns an authoritative accepted receipt and creates one durable work item', () => {
    seedAgent();
    const res = mockRes();
    handler(mockReq('POST', command()), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.receipt).toMatchObject({
      status: 'accepted',
      duplicate: false,
      targetAgentIds: ['mario'],
      messageId: expect.any(String),
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 1 });
  });

  it('returns the same receipt as a duplicate for an exact retry', () => {
    seedAgent();
    const first = mockRes();
    const retry = mockRes();
    handler(mockReq('POST', command()), first);
    handler(mockReq('POST', command()), retry);

    expect(retry.statusCode).toBe(200);
    expect(retry.body.receipt).toEqual({ ...first.body.receipt, duplicate: true });
    expect(getDb().prepare('SELECT COUNT(*) count FROM chat_message').get())
      .toEqual({ count: 1 });
  });

  it('returns a persisted rejected receipt when no team member can accept the requirement', () => {
    const res = mockRes();
    handler(mockReq('POST', command()), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_no_available_agent',
      userMessage: '当前交付没有可接手要求的团队成员',
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM chat_message').get())
      .toEqual({ count: 0 });
  });

  it('returns a durable rejected receipt for a project scope mismatch', () => {
    seedAgent();
    const res = mockRes();
    handler(mockReq('POST', command({ projectPath: 'C:/projects/other' })), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'human_command_project_scope_mismatch',
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM human_command_receipt').get())
      .toEqual({ count: 1 });
  });

  it('returns a durable rejected receipt when the delivery is missing', () => {
    seedAgent();
    const res = mockRes();
    handler(mockReq('POST', command({ deliveryId: 'missing-delivery' })), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'human_command_delivery_not_found',
    });
    expect(getDb().prepare('SELECT conversation_id FROM human_command_receipt').get())
      .toEqual({ conversation_id: null });
  });

  it('accepts a planning command through the same Human Command endpoint', () => {
    seedAgent();
    const res = mockRes();
    handler(mockReq('POST', command({
      type: 'delivery.plan.request',
      idempotencyKey: 'api-plan-1',
      content: undefined,
      targetAgentIds: undefined,
    })), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.receipt).toMatchObject({
      commandType: 'delivery.plan.request',
      status: 'accepted',
      targetAgentIds: ['mario'],
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 1 });
  });
});
