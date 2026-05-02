import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import handler from '@/pages/api/mutations';

function mockReq(method: string, body?: any): any {
  return { method, body: body ?? {} };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    _json: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) { res._json = data; return res; },
    end() { return res; },
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

async function seedConversation() {
  const { conversationRepo } = await import('@/server/repositories/conversation-repo');
  conversationRepo.create({ id: 'conv-1', title: 'Seed Conv' });
}

async function seedTask() {
  await seedConversation();
  const { taskRepo } = await import('@/server/repositories/task-repo');
  taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'Seed Task', agent_id: 'agent-a' });
}

describe('POST /api/mutations', () => {
  it('returns 405 for GET method', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(405);
  });

  it('conversation.create returns conversation', async () => {
    const req = mockReq('POST', { type: 'conversation.create', payload: { id: 'conv-1', title: 'New Conv' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('conv-1');
    expect(res._json.result.title).toBe('New Conv');
    expect(res._json.result.status).toBe('active');
  });

  it('conversation.update updates title', async () => {
    await seedConversation();
    const req = mockReq('POST', { type: 'conversation.update', payload: { id: 'conv-1', title: 'Updated' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('conv-1');

    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    expect(conversationRepo.getById('conv-1')!.title).toBe('Updated');
  });

  it('conversation.delete deletes conversation and its tasks', async () => {
    await seedTask();
    const req = mockReq('POST', { type: 'conversation.delete', payload: { id: 'conv-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);

    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(conversationRepo.getById('conv-1')).toBeUndefined();
    expect(taskRepo.getById('task-1')).toBeUndefined();
  });

  it('task.create creates task under conversation', async () => {
    await seedConversation();
    const req = mockReq('POST', {
      type: 'task.create',
      payload: { id: 'task-1', conversation_id: 'conv-1', title: 'New Task', agent_id: 'agent-a' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('task-1');
    expect(res._json.result.status).toBe('pending');
  });

  it('task.updateStatus changes status', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_progress' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('task-1');
    expect(res._json.result.status).toBe('in_progress');

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-1')!.status).toBe('in_progress');
  });

  it('task.updateStatus with reviewNote', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'approved', reviewNote: 'LGTM' },
    });
    const res = mockRes();
    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    const task = taskRepo.getById('task-1')!;
    expect(task.status).toBe('approved');
    expect(task.review_note).toBe('LGTM');
  });

  it('task.update updates fields', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'task.update',
      payload: { id: 'task-1', title: 'Renamed', description: 'Updated desc' },
    });
    const res = mockRes();
    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    const task = taskRepo.getById('task-1')!;
    expect(task.title).toBe('Renamed');
    expect(task.description).toBe('Updated desc');
  });

  it('task.delete removes task', async () => {
    await seedTask();
    const req = mockReq('POST', { type: 'task.delete', payload: { id: 'task-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res._json.ok).toBe(true);
    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-1')).toBeUndefined();
  });

  it('message.append creates message with sortable ID', async () => {
    await seedConversation();
    const req = mockReq('POST', {
      type: 'message.append',
      payload: { conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: 'Hello' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBeTruthy();
    expect(res._json.result.id.startsWith('msg-')).toBe(true);
  });

  it('session.create creates session', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'session.create',
      payload: { id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('ses-1');
    expect(res._json.result.status).toBe('active');
  });

  it('session.updateCliSessionId updates cli session', async () => {
    await seedTask();
    const { sessionRepo } = await import('@/server/repositories/session-repo');
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });

    const req = mockReq('POST', {
      type: 'session.updateCliSessionId',
      payload: { id: 'ses-1', cliSessionId: 'cli-123' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res._json.ok).toBe(true);
    expect(sessionRepo.getById('ses-1')!.cli_session_id).toBe('cli-123');
  });

  it('session.seal seals session', async () => {
    await seedTask();
    const { sessionRepo } = await import('@/server/repositories/session-repo');
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });

    const req = mockReq('POST', {
      type: 'session.seal',
      payload: { id: 'ses-1', reason: 'completed' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res._json.ok).toBe(true);
    expect(sessionRepo.getById('ses-1')!.status).toBe('sealed');
    expect(sessionRepo.getById('ses-1')!.seal_reason).toBe('completed');
  });

  it('session.sealByTask seals all active sessions for agent+task', async () => {
    await seedTask();
    const { sessionRepo } = await import('@/server/repositories/session-repo');
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0 });
    sessionRepo.create({ id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1 });

    const req = mockReq('POST', {
      type: 'session.sealByTask',
      payload: { agentId: 'agent-a', taskId: 'task-1', reason: 'done' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res._json.ok).toBe(true);
    expect(sessionRepo.getById('ses-1')!.status).toBe('sealed');
    expect(sessionRepo.getById('ses-2')!.status).toBe('sealed');
  });

  it('invocation.create creates invocation', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'invocation.create',
      payload: { id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a', task_id: 'task-1' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('inv-1');
    expect(res._json.result.status).toBe('queued');
  });

  it('invocation.updateStatus transitions queued → running → succeeded', async () => {
    await seedConversation();
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });

    const reqRunning = mockReq('POST', {
      type: 'invocation.updateStatus',
      payload: { id: 'inv-1', status: 'running' },
    });
    const resRunning = mockRes();
    await handler(reqRunning, resRunning);
    expect(resRunning._json.result.status).toBe('running');
    expect(invocationRepo.getById('inv-1')!.status).toBe('running');

    const reqSuccess = mockReq('POST', {
      type: 'invocation.updateStatus',
      payload: { id: 'inv-1', status: 'succeeded', exit_code: 0 },
    });
    const resSuccess = mockRes();
    await handler(reqSuccess, resSuccess);
    expect(resSuccess._json.result.status).toBe('succeeded');
    expect(invocationRepo.getById('inv-1')!.status).toBe('succeeded');
    expect(invocationRepo.getById('inv-1')!.exit_code).toBe(0);
  });

  it('event.append creates event', async () => {
    await seedTask();
    const req = mockReq('POST', {
      type: 'event.append',
      payload: { conversationId: 'conv-1', agentId: 'agent-a', type: 'agent.text', payload: { text: 'Hello' } },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBeTruthy();
    expect(res._json.result.id.startsWith('evt-')).toBe(true);
  });

  it('unknown mutation type returns 400', async () => {
    const req = mockReq('POST', { type: 'unknown.mutation', payload: {} });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toContain('Unknown mutation type');
  });
});
