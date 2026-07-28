import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { groupChatTaskFlow } from '@/server/task-flow/group-chat-task-flow';
import handler from '@/pages/api/task-graph';

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('GET /api/task-graph', () => {
  it('requires conversationId', async () => {
    const req = mockReq('GET');
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json.error).toContain('conversationId');
  });

  it('returns an empty graph for local-only conversations', async () => {
    const req = mockReq('GET', undefined, { conversationId: 'missing' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json).toMatchObject({
      conversationId: 'missing',
      tasks: [],
      edges: [],
      actions: [],
      artifacts: [],
      bindings: [],
      proofEvents: [],
    });
  });

  it('returns task graph view for a conversation', async () => {
    conversationRepo.create({ id: 'conv-1', title: 'Task graph' });
    const root = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: 'A2A 群聊协作重构',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      expectedRevision: 0,
      idempotencyKey: 'api-get-root',
    }).task;
    groupChatTaskFlow.splitTask({
      conversationId: 'conv-1',
      parentTaskId: root.id,
      actorId: 'planner',
      actorType: 'agent',
      expectedRevision: 1,
      idempotencyKey: 'api-get-split',
      children: [
        { title: '协作模型', ownerAgentId: 'architect' },
        { title: '群聊 UI', ownerAgentId: 'frontend' },
      ],
      dependencies: [{ fromTitle: '协作模型', toTitle: '群聊 UI' }],
    });

    const req = mockReq('GET', undefined, { conversationId: 'conv-1' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.conversationId).toBe('conv-1');
    expect(res._json.tasks).toHaveLength(3);
    expect(res._json.actions.map((action: any) => action.type)).toEqual([
      'task.created',
      'task.split',
    ]);
    expect(res._json.edges.filter((edge: any) => edge.type === 'subtask_of')).toHaveLength(2);
    expect(res._json.edges.filter((edge: any) => edge.type === 'depends_on')).toHaveLength(1);
  });

  it('rejects unsupported methods', async () => {
    const req = mockReq('PUT', {}, { conversationId: 'conv-1' });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });
});
