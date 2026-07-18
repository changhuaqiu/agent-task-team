import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import handler from '@/pages/api/mutations';

function mockReq(method: string, body?: any): any {
  return { method, body: body ?? {} };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    jsonCalls: 0,
    _json: null,
    status(code: number) { res.statusCode = code; return res; },
    json(data: any) {
      res.jsonCalls += 1;
      if (res.headersSent) {
        throw new Error('Response JSON was written more than once');
      }
      res.headersSent = true;
      res._json = data;
      return res;
    },
    end() {
      if (res.headersSent) {
        throw new Error('Response was ended more than once');
      }
      res.headersSent = true;
      return res;
    },
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

async function seedTeamPackConversation() {
  const { conversationRepo } = await import('@/server/repositories/conversation-repo');
  const { teamPackRepo } = await import('@/server/repositories/team-pack-repo');
  const pack = teamPackRepo.create({
    name: 'workflow-policy-pack',
    displayName: 'Workflow Policy Pack',
    description: 'Tests workflow-driven initial task assignment',
    teamMode: 'pipeline',
    roles: [
      { id: 'planner', displayName: 'Planner', soul: '# Planner', required: true },
      { id: 'coder', displayName: 'Coder', soul: '# Coder', required: true },
    ],
    workflow: {
      type: 'linear',
      steps: [
        { role: 'planner', action: 'plan', output: 'plan' },
        { role: 'coder', action: 'build', output: 'implementation' },
      ],
    },
    communicationMatrix: {
      planner: { canSendTo: ['coder'], canReceiveFrom: [] },
      coder: { canSendTo: [], canReceiveFrom: ['planner'] },
    },
  });
  conversationRepo.create({ id: 'conv-team', title: 'Team Conv', team_pack_id: pack.id });
  return pack;
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

  it('task.create assigns a TeamPack task through WorkflowPolicy when no explicit agent is supplied', async () => {
    await seedTeamPackConversation();
    const req = mockReq('POST', {
      type: 'task.create',
      payload: { id: 'task-team-1', conversation_id: 'conv-team', title: 'Plan the work' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.agent_id).toBe('planner');

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-team-1')!.agent_id).toBe('planner');
  });

  it('task.create rejects a non-TeamPack task without an explicit agent', async () => {
    await seedConversation();
    const req = mockReq('POST', {
      type: 'task.create',
      payload: { id: 'task-unassigned', conversation_id: 'conv-1', title: 'Needs an assignee' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonCalls).toBe(1);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toContain('No workflow assignment was available');

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-unassigned')).toBeUndefined();
    expect(taskRepo.list().some((task) => task.agent_id === '')).toBe(false);
  });

  it('task.create preserves an explicit agent instead of overriding with WorkflowPolicy', async () => {
    await seedTeamPackConversation();
    const req = mockReq('POST', {
      type: 'task.create',
      payload: { id: 'task-team-2', conversation_id: 'conv-team', title: 'Build directly', agent_id: 'coder' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.agent_id).toBe('coder');
  });

  it('tool.invoke task_create keeps TASKS.md in sync with the WorkflowPolicy assignee', async () => {
    await seedTeamPackConversation();
    const oldRoot = process.env.ATH_WORKSPACES_ROOT;
    const tempRoot = mkdtempSync(join(tmpdir(), 'ath-workflow-policy-'));
    process.env.ATH_WORKSPACES_ROOT = tempRoot;

    try {
      const req = mockReq('POST', {
        type: 'tool.invoke',
        payload: {
          toolName: 'task_create',
          conversationId: 'conv-team',
          agentId: 'fallback-agent',
          input: { title: 'Create team plan', description: 'Plan before building' },
        },
      });
      const res = mockRes();
      await handler(req, res);

      const { taskRepo } = await import('@/server/repositories/task-repo');
      const { readTasksMd } = await import('@/server/task-file-service');
      expect(res.statusCode).toBe(200);
      expect(res.jsonCalls).toBe(1);
      expect(res._json.ok).toBe(true);
      expect(res._json.result.id).toBe('TASK-001');
      expect(res._json.result.agent_id).toBe('planner');
      expect(taskRepo.getById('TASK-001')!.agent_id).toBe('planner');
      expect(readTasksMd(join(tempRoot, 'conv-team')).tasks[0].agent).toBe('planner');
    } finally {
      if (oldRoot === undefined) {
        delete process.env.ATH_WORKSPACES_ROOT;
      } else {
        process.env.ATH_WORKSPACES_ROOT = oldRoot;
      }
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('tool.invoke task_create preserves an explicit input agent over WorkflowPolicy', async () => {
    await seedTeamPackConversation();
    const req = mockReq('POST', {
      type: 'tool.invoke',
      payload: {
        toolName: 'task_create',
        conversationId: 'conv-team',
        agentId: 'fallback-agent',
        input: { title: 'Build directly', description: 'Skip planning', agent_id: 'coder' },
      },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonCalls).toBe(1);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.agent_id).toBe('coder');

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('TASK-001')!.agent_id).toBe('coder');
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

  it('task.updateStatus publishes a persisted task notification to related agents', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        actorId: 'reviewer',
        actorType: 'agent',
        evidence: {
          installResult: 'pnpm install passed',
          buildResult: 'pnpm build passed',
          testResult: 'pnpm test passed',
          impactEvidence: 'repository query: task update status',
        },
      },
    });
    const res = mockRes();
    res.socket = { server: { io: { to, emit: vi.fn() } } };

    await handler(req, res);

    const { messageRepo } = await import('@/server/repositories/message-repo');
    const messages = messageRepo.getByConversation('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].sender_id).toBe('task-notifier');
    expect(messages[0].content).toContain('@agent-a');
    expect(JSON.parse(messages[0].metadata ?? '{}')).toMatchObject({
      startsA2AHandoff: false,
      taskId: 'task-1',
    });
    expect(to).toHaveBeenCalledWith('conv-1');
    expect(emit).toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'task-1',
      recipients: ['agent-a'],
    }));
  });

  it('task.updateStatus blocks review without implementation evidence', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_review', actorId: 'agent-a', actorType: 'agent' },
    });
    const res = mockRes();
    res.socket = { server: { io: { to } } };

    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { proofLogRepo } = await import('@/server/repositories/proof-log-repo');
    expect(res.statusCode).toBe(403);
    expect(res._json.error).toContain('installResult');
    expect(taskRepo.getById('task-1')!.status).toBe('pending');
    expect(proofLogRepo.getByConversation('conv-1')).toContainEqual(expect.objectContaining({
      event_type: 'task_graph.gate_evidence.blocked',
      reason_code: 'task_graph.gate_evidence_required',
    }));
    expect(to).toHaveBeenCalledWith('conv-1');
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-1',
      agentId: 'agent-a',
      reasonCode: 'missing_implementation_evidence',
      metadata: expect.objectContaining({
        missingFields: expect.arrayContaining(['installResult', 'buildResult', 'impactEvidence']),
      }),
    }));
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

  it('task.update notifies both old and new owners when agentId changes', async () => {
    await seedTask();
    const emit = vi.fn();
    const req = mockReq('POST', {
      type: 'task.update',
      payload: { id: 'task-1', agentId: 'agent-b', actorId: 'planner', actorType: 'agent' },
    });
    const res = mockRes();
    res.socket = { server: { io: { to: vi.fn(() => ({ emit })), emit: vi.fn() } } };

    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');
    expect(taskRepo.getById('task-1')!.agent_id).toBe('agent-b');
    expect(JSON.parse(messageRepo.getByConversation('conv-1')[0].mentions ?? '[]')).toEqual(['agent-b', 'agent-a']);
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
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { sessionRepo } = await import('@/server/repositories/session-repo');
    conversationRepo.create({ id: 'conv-2', title: 'Second project' });
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 0 });
    sessionRepo.create({ id: 'ses-2', conversationId: 'conv-2', agentId: 'agent-a', taskId: 'task-1', seq: 1 });

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

  it('dispatch.enqueue keeps the originating conversation scope', async () => {
    await seedConversation();
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');
    const req = mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'agent-a',
        conversationId: 'conv-1',
        prompt: 'queued project turn',
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(invocationRepo.getByConversation('conv-1')).toContainEqual(expect.objectContaining({
      agent_id: 'agent-a',
      prompt: 'queued project turn',
    }));
    expect(invocationRepo.getByConversation('default')).toHaveLength(0);
  });

  it('dispatch.enqueue rejects a missing conversation scope', async () => {
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');
    const req = mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: { agentId: 'agent-a', prompt: 'must not use default' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json).toEqual({ ok: false, error: 'dispatch.enqueue requires conversationId' });
    expect(invocationRepo.getByConversation('default')).toHaveLength(0);
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
