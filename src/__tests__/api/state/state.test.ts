import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import handler from '@/pages/api/state';

function mockReq(method: string, body?: any, query?: any): any {
  return { method, body: body ?? {}, query: query ?? {} };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    _json: null,
    _body: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) { res._json = data; return res; },
    end(data?: string) { res._body = data ?? null; return res; },
  };
  return res;
}

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
});

afterEach(() => {
  resetDb();
});

describe('GET /api/state', () => {
  it('returns empty state when no data', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.conversations).toEqual([]);
    expect(res._json.tasks).toEqual([]);
    expect(res._json.recentMessages).toEqual({});
    expect(res._json.activeSessions).toEqual([]);
    expect(res._json.recentInvocations).toEqual([]);
  });

  it('returns conversations, tasks, messages, sessions, and invocations', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');
    const { sessionRepo } = await import('@/server/repositories/session-repo');
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test Conv' });
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'Task', agent_id: 'agent-a' });
    messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'Hello' });
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.conversations.length).toBe(1);
    expect(res._json.conversations[0].id).toBe('conv-1');
    expect(res._json.tasks.length).toBe(1);
    expect(res._json.tasks[0].id).toBe('task-1');
    expect(res._json.recentMessages['conv-1'].length).toBe(1);
    expect(res._json.activeSessions.length).toBe(1);
    expect(res._json.activeSessions[0].id).toBe('ses-1');
    expect(res._json.recentInvocations.length).toBe(1);
    expect(res._json.recentInvocations[0].id).toBe('inv-1');
  });

  it('limits messages to 100 per conversation', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    for (let i = 0; i < 120; i++) {
      messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: `Msg ${i}` });
    }

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json.recentMessages['conv-1'].length).toBe(100);
  });

  it('limits recent invocations to 50', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    for (let i = 0; i < 60; i++) {
      invocationRepo.create({ id: `inv-${i}`, conversation_id: 'conv-1', agent_id: 'agent-a' });
    }

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json.recentInvocations.length).toBe(50);
  });

  it('excludes sealed sessions from activeSessions', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { sessionRepo } = await import('@/server/repositories/session-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'agent-a' });
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.create({ id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1 });
    sessionRepo.seal('ses-2', 'done');

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json.activeSessions.length).toBe(1);
    expect(res._json.activeSessions[0].id).toBe('ses-1');
  });

  it('returns dynamic agent skill bindings beyond preset agent ids', async () => {
    const { skillRepo } = await import('@/server/repositories/skill-repo');

    const skill = skillRepo.create({
      name: 'Planner Skill',
      content: 'Use planner skill.',
    });
    skillRepo.setAgentSkills('planner', [skill.id]);

    const req = mockReq('GET');
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.agentSkillIds.planner).toEqual([skill.id]);
  });
});

describe('POST /api/state', () => {
  it('returns 405 for POST method', async () => {
    const req = mockReq('POST');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });
});
