import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
  vi.useRealTimers();
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
    expect(res._json).not.toHaveProperty('recentInvocations');
    expect(res._json.a2aSnapshots).toEqual([]);
    expect(res._json.dispatchReceipts).toEqual([]);
  });

  it('hydrates acknowledged dispatch receipts with their source message identity', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { executionEnvelopeRepo } = await import('@/server/repositories/execution-envelope-repo');
    conversationRepo.create({ id: 'conv-receipt', title: 'Receipt hydration' });
    const envelope = executionEnvelopeRepo.create({
      source: 'a2a', intent: 'delegate', conversationId: 'conv-receipt',
      fromNodeId: 'node-local', toNodeId: 'node-local', toAgentId: 'mario',
      payload: { sourceMessageId: 'message-1', contextRefs: [] },
    });
    executionEnvelopeRepo.transition(envelope.id, { to: 'validated', expectedFrom: 'drafted' });
    executionEnvelopeRepo.transition(envelope.id, { to: 'routed', expectedFrom: 'validated' });
    executionEnvelopeRepo.transition(envelope.id, { to: 'sent', expectedFrom: 'routed' });
    executionEnvelopeRepo.transition(envelope.id, { to: 'acknowledged', expectedFrom: 'sent' });

    const res = mockRes();
    await handler(mockReq('GET'), res);

    expect(res._json.dispatchReceipts).toContainEqual(expect.objectContaining({
      conversationId: 'conv-receipt', sourceMessageId: 'message-1',
      targetAgentId: 'mario', phase: 'acknowledged',
    }));
  });

  it('hydrates acknowledgements for more than 50 visible source messages', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');
    const { executionEnvelopeRepo } = await import('@/server/repositories/execution-envelope-repo');
    conversationRepo.create({ id: 'conv-many-receipts', title: 'Receipt window' });
    const sourceMessageIds = Array.from({ length: 60 }, (_, index) => messageRepo.append({
      conversationId: 'conv-many-receipts',
      senderType: 'human',
      senderId: 'human',
      content: `Message ${index}`,
    }));
    for (const sourceMessageId of sourceMessageIds) {
      const envelope = executionEnvelopeRepo.create({
        source: 'user', intent: 'delegate', conversationId: 'conv-many-receipts',
        fromNodeId: 'node-local', toNodeId: 'node-local', toAgentId: 'mario',
        payload: { sourceMessageId, contextRefs: [] },
      });
      executionEnvelopeRepo.transition(envelope.id, { to: 'validated', expectedFrom: 'drafted' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'routed', expectedFrom: 'validated' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'sent', expectedFrom: 'routed' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'acknowledged', expectedFrom: 'sent' });
    }
    const supersededSourceMessageId = sourceMessageIds[0];
    let latestEnvelopeId = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const envelope = executionEnvelopeRepo.create({
        source: 'user', intent: 'delegate', conversationId: 'conv-many-receipts',
        fromNodeId: 'node-local', toNodeId: 'node-local', toAgentId: 'mario',
        payload: { sourceMessageId: supersededSourceMessageId, contextRefs: [] },
      });
      latestEnvelopeId = envelope.id;
      executionEnvelopeRepo.transition(envelope.id, { to: 'validated', expectedFrom: 'drafted' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'routed', expectedFrom: 'validated' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'sent', expectedFrom: 'routed' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'acknowledged', expectedFrom: 'sent' });
    }

    const res = mockRes();
    await handler(mockReq('GET'), res);

    const receipts = res._json.dispatchReceipts.filter((receipt: any) => (
      receipt.conversationId === 'conv-many-receipts'
    ));
    expect(receipts).toHaveLength(60);
    expect(receipts.map((receipt: any) => receipt.sourceMessageId)).toContain(sourceMessageIds[0]);
    expect(receipts.find((receipt: any) => receipt.sourceMessageId === supersededSourceMessageId).receiptId)
      .toBe(`${latestEnvelopeId}:acknowledged`);
  });

  it('bounds fallback receipts by terminal update time and keeps a delayed acknowledgement', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T00:00:00.000Z'));
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { executionEnvelopeRepo } = await import('@/server/repositories/execution-envelope-repo');
    conversationRepo.create({ id: 'conv-bounded-receipts', title: 'Bounded receipts' });
    const delayed = executionEnvelopeRepo.create({
      source: 'a2a', intent: 'delegate', conversationId: 'conv-bounded-receipts',
      fromNodeId: 'node-local', toNodeId: 'node-local', toAgentId: 'mario',
      payload: { sourceMessageId: 'delayed-source', contextRefs: [] },
    });

    for (let index = 0; index < 205; index += 1) {
      vi.setSystemTime(new Date(`2026-08-25T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`));
      const envelope = executionEnvelopeRepo.create({
        source: 'a2a', intent: 'delegate', conversationId: 'conv-bounded-receipts',
        fromNodeId: 'node-local', toNodeId: 'node-local', toAgentId: 'luigi',
        payload: { sourceMessageId: `historical-${index}`, contextRefs: [] },
      });
      executionEnvelopeRepo.transition(envelope.id, { to: 'validated', expectedFrom: 'drafted' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'routed', expectedFrom: 'validated' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'sent', expectedFrom: 'routed' });
      executionEnvelopeRepo.transition(envelope.id, { to: 'acknowledged', expectedFrom: 'sent' });
    }

    vi.setSystemTime(new Date('2026-08-26T00:00:00.000Z'));
    executionEnvelopeRepo.transition(delayed.id, { to: 'validated', expectedFrom: 'drafted' });
    executionEnvelopeRepo.transition(delayed.id, { to: 'routed', expectedFrom: 'validated' });
    executionEnvelopeRepo.transition(delayed.id, { to: 'sent', expectedFrom: 'routed' });
    executionEnvelopeRepo.transition(delayed.id, { to: 'acknowledged', expectedFrom: 'sent' });

    const res = mockRes();
    await handler(mockReq('GET'), res);
    const receipts = res._json.dispatchReceipts.filter((receipt: any) => (
      receipt.conversationId === 'conv-bounded-receipts'
    ));
    expect(receipts).toHaveLength(200);
    expect(receipts).toContainEqual(expect.objectContaining({
      sourceMessageId: 'delayed-source',
      receiptId: `${delayed.id}:acknowledged`,
    }));
  });

  it('returns conversations, tasks, messages, and sessions without debug invocations', async () => {
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
    expect(res._json).not.toHaveProperty('recentInvocations');
  });

  it('returns the managed task statuses without a browser compatibility projection', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');

    conversationRepo.create({ id: 'conv-status', title: 'Status compatibility' });
    taskRepo.create({
      id: 'task-proposed',
      conversation_id: 'conv-status',
      title: 'Proposed',
      agent_id: 'mario',
      initialStatus: 'proposed',
    });
    taskRepo.create({
      id: 'task-ready',
      conversation_id: 'conv-status',
      title: 'Ready',
      agent_id: 'luigi',
    });
    taskRepo.create({
      id: 'task-cancelled',
      conversation_id: 'conv-status',
      title: 'Cancelled',
      agent_id: 'peach',
    });
    taskRepo.transition('task-cancelled', { to: 'cancelled', expectedFrom: 'ready' });

    const res = mockRes();
    await handler(mockReq('GET'), res);

    expect(Object.fromEntries(res._json.tasks.map((task: any) => [task.id, task.status])))
      .toEqual({
        'task-proposed': 'proposed',
        'task-ready': 'ready',
        'task-cancelled': 'cancelled',
      });
  });

  it('derives the autonomous conversation flag from persisted delivery runs', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { AutonomousDeliveryRepository } = await import('@/server/autonomous-delivery/repository');
    conversationRepo.create({ id: 'conv-autonomous', title: 'Autonomous' });
    conversationRepo.create({ id: 'conv-interactive', title: 'Interactive' });
    new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'state-autonomous-conversation',
      goal: 'Deliver autonomously',
      acceptanceCriteria: ['Result is verified'],
      scope: { conversationId: 'conv-autonomous', projectPath: 'C:/fixture' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 3,
        maxRepairCycles: 2,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: true,
        requireMerge: false,
      },
    });

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.conversations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'conv-autonomous', autonomous: true }),
      expect.objectContaining({ id: 'conv-interactive', autonomous: false }),
    ]));
  });

  it('returns the latest 200 messages for bounded workspace hydration', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    for (let i = 0; i < 240; i++) {
      messageRepo.append({ conversationId: 'conv-1', senderType: 'human', senderId: 'u1', content: `Msg ${i}` });
    }

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json.recentMessages['conv-1']).toHaveLength(200);
    expect(res._json.recentMessages['conv-1'][0].content).toBe('Msg 40');
    expect(res._json.recentMessages['conv-1'].at(-1).content).toBe('Msg 239');
  });

  it('keeps invocation debug payloads out of workspace hydration', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    for (let i = 0; i < 60; i++) {
      invocationRepo.create({ id: `inv-${i}`, conversation_id: 'conv-1', agent_id: 'agent-a' });
    }

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json).not.toHaveProperty('recentInvocations');
  });

  it('excludes sealed sessions from activeSessions', async () => {
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { sessionRepo } = await import('@/server/repositories/session-repo');

    conversationRepo.create({ id: 'conv-1', title: 'Test' });
    taskRepo.create({ id: 'task-1', conversation_id: 'conv-1', title: 'T1', agent_id: 'agent-a' });
    sessionRepo.create({ id: 'ses-1', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1' });
    sessionRepo.seal('ses-1', 'done');
    sessionRepo.create({ id: 'ses-2', conversationId: 'conv-1', agentId: 'agent-a', taskId: 'task-1', seq: 1 });

    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);

    expect(res._json.activeSessions.length).toBe(1);
    expect(res._json.activeSessions[0].id).toBe('ses-2');
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
