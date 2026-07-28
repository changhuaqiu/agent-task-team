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

async function seedAgent() {
  const { upsertAgent } = await import('@/server/db/agentQueries');
  upsertAgent({
    id: 'mario',
    name: 'Mario',
    roleCardId: 'developer',
    theme: 'red',
    emoji: '🍄',
    isPreset: true,
  });
}

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

  it('rejects malformed mutation bodies', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { type: 'dispatch.enqueue' }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json.ok).toBe(false);
  });

  it('dispatch.enqueue persists an idempotent Agent Inbox command', async () => {
    await seedAgent();
    await seedTask();
    const body = {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        prompt: 'Continue the task',
        referencedTaskId: 'task-1',
        source: 'workflow',
        idempotencyKey: 'browser-request-1',
      },
    };
    const first = mockRes();
    const second = mockRes();

    await handler(mockReq('POST', body), first);
    await handler(mockReq('POST', body), second);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second._json.result.id).toBe(first._json.result.id);
    expect(first._json.result.command).toMatchObject({
      source: 'workflow',
      prompt: 'Continue the task',
      taskId: 'task-1',
    });
    const { getDb } = await import('@/server/db/index');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM agent_inbox_item').get())
      .toEqual({ count: 1 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM invocation').get())
      .toEqual({ count: 0 });
  });

  it('dispatch.enqueue reports an idempotency conflict', async () => {
    await seedAgent();
    await seedConversation();
    const first = {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        prompt: 'First',
        idempotencyKey: 'same-key',
      },
    };
    await handler(mockReq('POST', first), mockRes());
    const conflict = mockRes();

    await handler(mockReq('POST', {
      ...first,
      payload: { ...first.payload, prompt: 'Different' },
    }), conflict);

    expect(conflict.statusCode).toBe(409);
    expect(conflict._json.reasonCode).toBe('agent_inbox_idempotency_conflict');
  });

  it('dispatch.enqueue validates source and task scope before persisting', async () => {
    await seedAgent();
    await seedTask();
    const invalidSource = mockRes();
    await handler(mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        prompt: 'Invalid',
        source: 'socket',
        idempotencyKey: 'invalid-source',
      },
    }), invalidSource);
    expect(invalidSource.statusCode).toBe(400);

    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    conversationRepo.create({ id: 'conv-2', title: 'Other' });
    const mismatch = mockRes();
    await handler(mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-2',
        referencedTaskId: 'task-1',
        prompt: 'Wrong project',
        idempotencyKey: 'wrong-project',
      },
    }), mismatch);
    expect(mismatch.statusCode).toBe(409);
  });

  it('dispatch.cancel changes only queued Inbox work', async () => {
    await seedAgent();
    await seedConversation();
    const enqueue = {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        prompt: 'Cancel me',
        idempotencyKey: 'cancel-me',
      },
    };
    await handler(mockReq('POST', enqueue), mockRes());
    const cancelled = mockRes();

    await handler(mockReq('POST', {
      type: 'dispatch.cancel',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        idempotencyKey: 'cancel-me',
      },
    }), cancelled);

    expect(cancelled.statusCode).toBe(200);
    expect(cancelled._json.result).toEqual({ cancelled: 1, status: 'cancelled' });
    const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
    expect(new AgentInbox().listPending('conv-1')).toHaveLength(0);
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

  it('conversation.delete removes an autonomous run whose root task belongs to the project', async () => {
    await seedConversation();
    const { groupChatTaskFlow } = await import('@/server/task-flow/group-chat-task-flow');
    const root = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: 'Root task',
      description: 'Creates task_action and task bindings',
      ownerAgentId: 'agent-a',
      actorId: 'agent-a',
      actorType: 'agent',
      expectedRevision: 0,
      idempotencyKey: 'state-mutation-delete-root',
    });
    const { AutonomousDeliveryRepository } = await import('@/server/autonomous-delivery/repository');
    const repo = new AutonomousDeliveryRepository();
    const run = repo.createRun({
      idempotencyKey: 'mutation-delete-autonomous-run',
      goal: '删除自主交付项目',
      acceptanceCriteria: ['项目及运行事实均被删除'],
      scope: { conversationId: 'conv-1', projectPath: process.cwd() },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: true,
        requireMerge: false,
      },
    });
    repo.transitionRun({
      runId: run.run.id,
      to: 'active',
      stage: 'executing',
      rootTaskId: root.task.id,
      expectedRevision: run.run.revision,
    });

    const req = mockReq('POST', { type: 'conversation.delete', payload: { id: 'conv-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(repo.getSnapshot(run.run.id)).toBeUndefined();
    const { getDb } = await import('@/server/db');
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task_action WHERE conversation_id=?')
      .get('conv-1')).toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM task WHERE conversation_id=?')
      .get('conv-1')).toEqual({ count: 0 });
  });

  it('conversation.delete removes project-scoped evaluation data', async () => {
    await seedConversation();
    const { getDb } = await import('@/server/db');
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO eval_dataset
      (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
      VALUES (?,?,?,?,1,'active','test',?,?)`)
      .run('dataset-delete', 'conv-1', 'Delete fixture', 'Project-scoped fixture', now, now);
    db.prepare(`INSERT INTO eval_case
      (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,
       content_hash,redaction_status,created_at)
      VALUES (?,?,?,?,?,'{}','{}','{}',?,'redacted',?)`)
      .run('case-delete', 'dataset-delete', 'case-1', 'held_out', 'manual', 'hash-delete', now);

    const req = mockReq('POST', { type: 'conversation.delete', payload: { id: 'conv-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS count FROM eval_dataset WHERE conversation_id=?')
      .get('conv-1')).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM eval_case WHERE dataset_id=?')
      .get('dataset-delete')).toEqual({ count: 0 });
  });

  it('conversation.delete rolls back the whole aggregate when an unexpected foreign key blocks commit', async () => {
    await seedTask();
    const { getDb } = await import('@/server/db');
    getDb().exec(`
      CREATE TABLE conversation_delete_guard (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id)
      );
      INSERT INTO conversation_delete_guard (id, conversation_id) VALUES ('guard-1', 'conv-1');
    `);

    const req = mockReq('POST', { type: 'conversation.delete', payload: { id: 'conv-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(500);
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(conversationRepo.getById('conv-1')).toBeDefined();
    expect(taskRepo.getById('task-1')).toBeDefined();
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
    expect(res._json.result.status).toBe('ready');
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

  it('task.updateStatus replays the frozen result when the first HTTP response is lost', async () => {
    await seedTask();
    const body = {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_progress',
        idempotencyKey: 'browser-task-status-command-1',
      },
    };
    const first = mockRes();
    await handler(mockReq('POST', body), first);
    const retry = mockRes();
    await handler(mockReq('POST', body), retry);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry._json).toEqual(first._json);
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { taskGraphRepo } = await import('@/server/repositories/task-graph-repo');
    expect(taskRepo.getById('task-1')).toMatchObject({
      status: 'in_progress',
      revision: 1,
    });
    expect(taskGraphRepo.listActionsForTask('task-1').filter(
      (action) => action.type === 'task.status_changed',
    )).toHaveLength(1);
  });

  it('task.updateStatus replays evidence admission without creating a duplicate Gate', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { taskGraphRepo } = await import('@/server/repositories/task-graph-repo');
    const { qualityGateRepo } = await import('@/server/quality-gate/repository');
    taskRepo.transition('task-1', { to: 'in_progress' });
    const body = {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        actorId: 'agent-a',
        actorType: 'agent',
        idempotencyKey: 'browser-task-review-command-1',
        evidence: {
          installResult: 'passed',
          buildResult: 'passed',
          testResult: 'passed',
          impactEvidence: 'reviewed',
        },
      },
    };
    const first = mockRes();
    await handler(mockReq('POST', body), first);
    const retry = mockRes();
    await handler(mockReq('POST', body), retry);

    expect(first.statusCode).toBe(200);
    expect(retry._json).toEqual(first._json);
    expect(taskRepo.getById('task-1')).toMatchObject({
      status: 'in_review',
      revision: 2,
    });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.review_requested')).toHaveLength(1);
    expect(qualityGateRepo.listForTarget('task', 'task-1')).toEqual([]);
  });

  it('task.updateStatus publishes a persisted task notification to related agents', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    taskRepo.transition('task-1', { to: 'in_progress' });
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
    const submit = vi.fn(() => ({
      handled: true,
      disposition: 'accepted' as const,
      completion: new Promise<never>(() => {}),
    }));
    const io = { to };
    const { registerInvocationCoordinator } = await import('@/server/invocation-pipeline/registry');
    registerInvocationCoordinator(io as never, { submit } as never);
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_review', actorId: 'agent-a', actorType: 'agent' },
    });
    const res = mockRes();
    res.socket = { server: { io } };

    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(res.statusCode).toBe(403);
    expect(res._json.error).toContain('installResult');
    expect(taskRepo.getById('task-1')!.status).toBe('ready');
    expect(to).toHaveBeenCalledWith('conv-1');
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-1',
      agentId: 'agent-a',
      reasonCode: 'missing_implementation_evidence',
      metadata: expect.objectContaining({
        missingFields: expect.arrayContaining(['installResult', 'buildResult', 'impactEvidence']),
      }),
    }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      taskId: 'task-1',
      agentId: 'agent-a',
      contextScenario: 'recovery',
      wakeup: expect.objectContaining({ reasonCode: 'missing_implementation_evidence' }),
    }));
  });

  it('routes WebUI evidence recovery to the Task owner when actorId is omitted', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const submit = vi.fn(() => ({
      handled: true,
      disposition: 'accepted' as const,
      completion: new Promise<never>(() => {}),
    }));
    const io = { to };
    const { registerInvocationCoordinator } = await import('@/server/invocation-pipeline/registry');
    registerInvocationCoordinator(io as never, { submit } as never);
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_review' },
    });
    const res = mockRes();
    res.socket = { server: { io } };

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      taskId: 'task-1',
      agentId: 'agent-a',
      contextScenario: 'recovery',
    }));
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-1',
      agentId: 'agent-a',
      reasonCode: 'missing_implementation_evidence',
    }));
    expect(submit).not.toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'mutation-api',
    }));
  });

  it('tool.invoke submits gate recovery to Harness without a browser executor', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const submit = vi.fn(() => ({
      handled: true,
      disposition: 'accepted' as const,
      completion: new Promise<never>(() => {}),
    }));
    const io = { to };
    const { registerInvocationCoordinator } = await import('@/server/invocation-pipeline/registry');
    registerInvocationCoordinator(io as never, { submit } as never);
    const req = mockReq('POST', {
      type: 'tool.invoke',
      payload: {
        toolName: 'task_update_status',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        input: { task_id: 'task-1', status: 'in_review' },
      },
    });
    const res = mockRes();
    res.socket = { server: { io } };

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-1',
      taskId: 'task-1',
      agentId: 'agent-a',
      contextScenario: 'recovery',
      wakeup: expect.objectContaining({ reasonCode: 'missing_implementation_evidence' }),
    }));
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      projectId: 'conv-1',
    }));
  });

  it('tool.invoke task_update_status replays a lost response exactly once', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { taskGraphRepo } = await import('@/server/repositories/task-graph-repo');
    const { qualityGateRepo } = await import('@/server/quality-gate/repository');
    taskRepo.transition('task-1', { to: 'in_progress' });
    const body = {
      type: 'tool.invoke',
      payload: {
        toolName: 'task_update_status',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        input: {
          task_id: 'task-1',
          status: 'in_review',
          evidence: {
            installResult: 'passed',
            buildResult: 'passed',
            testResult: 'passed',
            impactEvidence: 'reviewed',
          },
        },
      },
    };
    const first = mockRes();
    await handler(mockReq('POST', body), first);
    const retry = mockRes();
    await handler(mockReq('POST', body), retry);

    expect(first.statusCode).toBe(200);
    expect(retry._json).toEqual(first._json);
    expect(taskRepo.getById('task-1')).toMatchObject({
      status: 'in_review',
      revision: 2,
    });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.review_requested')).toHaveLength(1);
    expect(qualityGateRepo.listForTarget('task', 'task-1')).toEqual([]);
  });

  it('tool.invoke cannot mark Task done from caller-provided evidence', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    const res = mockRes();
    await handler(mockReq('POST', {
      type: 'tool.invoke',
      payload: {
        toolName: 'task_update_status',
        conversationId: 'conv-1',
        agentId: 'agent-a',
        input: {
          task_id: 'task-1',
          status: 'done',
          evidence: {
            mergedToMain: true,
            mainInstallResult: 'passed',
            mainBuildResult: 'passed',
            mainTestResult: 'passed',
            mainImpactReviewResult: 'passed',
          },
        },
      },
    }), res);

    expect(res.statusCode).toBe(403);
    expect(res._json.error).toContain('QualityGate passed');
    expect(taskRepo.getById('task-1')?.status).toBe('in_review');
  });

  it('tool.invoke task_assign replays a lost response exactly once', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { taskGraphRepo } = await import('@/server/repositories/task-graph-repo');
    const body = {
      type: 'tool.invoke',
      payload: {
        toolName: 'task_assign',
        conversationId: 'conv-1',
        agentId: 'planner',
        input: { task_id: 'task-1', agent_id: 'agent-b' },
      },
    };
    const first = mockRes();
    await handler(mockReq('POST', body), first);
    const retry = mockRes();
    await handler(mockReq('POST', body), retry);

    expect(first.statusCode).toBe(200);
    expect(retry._json).toEqual(first._json);
    expect(taskRepo.getById('task-1')).toMatchObject({
      agent_id: 'agent-b',
      revision: 1,
    });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.claimed')).toHaveLength(1);
  });

  it('task.updateStatus cannot fabricate done for a Git-backed task', async () => {
    await seedTask();
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    conversationRepo.update('conv-1', { git_repo_root: 'C:/repo' });
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1', status: 'done', actorId: 'mario', actorType: 'agent',
        evidence: {
          mergedToMain: true, mainInstallResult: 'passed', mainBuildResult: 'passed',
          mainTestResult: 'passed', mainImpactReviewResult: 'passed',
        },
      },
    });
    const res = mockRes();
    res.socket = { server: { io: { to: vi.fn(() => ({ emit: vi.fn() })) } } };

    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(res.statusCode).toBe(403);
    expect(res._json.error).toContain('QualityGate passed');
    expect(taskRepo.getById('task-1')?.status).not.toBe('done');
  });

  it('task.updateStatus cannot mark a non-Git task done from caller evidence', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_review' });
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'done',
        reviewNote: 'LGTM',
        evidence: {
          mergedToMain: true,
          mainInstallResult: 'passed',
          mainBuildResult: 'passed',
          mainTestResult: 'passed',
          mainImpactReviewResult: 'passed',
        },
      },
    });
    const res = mockRes();
    await handler(req, res);

    const task = taskRepo.getById('task-1')!;
    expect(res.statusCode).toBe(403);
    expect(res._json.error).toContain('QualityGate passed');
    expect(task.status).toBe('in_review');
    expect(task.review_note).toBeNull();
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

  it('task.update replays a browser command and updates dependency edges atomically', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { taskGraphRepo } = await import('@/server/repositories/task-graph-repo');
    taskRepo.create({
      id: 'task-dependency',
      conversation_id: 'conv-1',
      title: 'Dependency',
      agent_id: 'agent-a',
    });
    const body = {
      type: 'task.update',
      payload: {
        id: 'task-1',
        title: 'Depends on setup',
        dependencies: ['task-dependency'],
        idempotencyKey: 'browser-task-update-command-1',
      },
    };

    const first = mockRes();
    await handler(mockReq('POST', body), first);
    const retry = mockRes();
    await handler(mockReq('POST', body), retry);

    expect(first.statusCode).toBe(200);
    expect(retry.statusCode).toBe(200);
    expect(retry._json).toEqual(first._json);
    expect(taskRepo.getById('task-1')).toMatchObject({
      title: 'Depends on setup',
      dependencies: JSON.stringify(['task-dependency']),
      revision: 1,
    });
    expect(taskGraphRepo.listEdges('conv-1').filter(
      (edge) => edge.type === 'depends_on',
    )).toMatchObject([{
      from_task_id: 'task-1',
      to_task_id: 'task-dependency',
    }]);
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

  it('task.delete records an owner-controlled cancellation instead of erasing history', async () => {
    await seedTask();
    const req = mockReq('POST', { type: 'task.delete', payload: { id: 'task-1' } });
    const res = mockRes();
    await handler(req, res);

    expect(res._json.ok).toBe(true);
    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-1')).toMatchObject({
      status: 'cancelled',
      revision: 1,
    });
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
    expect(res._json.result.status).toBe('planned');
  });

  it('invocation.transition separates lifecycle from outcome', async () => {
    await seedConversation();
    const { invocationRepo } = await import('@/server/repositories/invocation-repo');
    invocationRepo.create({ id: 'inv-1', conversation_id: 'conv-1', agent_id: 'agent-a' });

    const reqRunning = mockReq('POST', {
      type: 'invocation.transition',
      payload: { id: 'inv-1', to: 'starting', expectedFrom: 'planned' },
    });
    const resRunning = mockRes();
    await handler(reqRunning, resRunning);
    expect(resRunning._json.result.status).toBe('starting');
    expect(invocationRepo.getById('inv-1')!.status).toBe('starting');

    const reqSuccess = mockReq('POST', {
      type: 'invocation.transition',
      payload: {
        id: 'inv-1',
        to: 'terminated',
        expectedFrom: 'starting',
        outcome: 'completed',
        exit_code: 0,
      },
    });
    const resSuccess = mockRes();
    await handler(reqSuccess, resSuccess);
    expect(resSuccess._json.result).toMatchObject({ status: 'terminated', outcome: 'completed' });
    expect(invocationRepo.getById('inv-1')).toMatchObject({
      status: 'terminated',
      outcome: 'completed',
    });
    expect(invocationRepo.getById('inv-1')!.exit_code).toBe(0);
  });

  it('dispatch.enqueue keeps the originating conversation scope', async () => {
    await seedAgent();
    await seedConversation();
    const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
    const req = mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: {
        agentId: 'mario',
        conversationId: 'conv-1',
        prompt: 'queued project turn',
        idempotencyKey: 'queued-project-turn',
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(new AgentInbox().listPending('conv-1')).toContainEqual(expect.objectContaining({
      projectAgentId: 'mario',
      command: expect.objectContaining({ prompt: 'queued project turn' }),
    }));
    expect(new AgentInbox().listPending('default')).toHaveLength(0);
  });

  it('a2a.human_handoff creates authoritative collaboration and Inbox work', async () => {
    await seedAgent();
    await seedConversation();
    const req = mockReq('POST', {
      type: 'a2a.human_handoff',
      payload: {
        conversationId: 'conv-1',
        messageId: 'message-human-1',
        prompt: 'Implement the accepted design',
        targetAgentIds: ['mario'],
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.result).toMatchObject({
      status: 'offered',
      handoff: {
        passes: [{ toAgentId: 'mario', status: 'offered' }],
        inboxItems: [{
          projectAgentId: 'mario',
          status: 'enqueued',
          command: { source: 'a2a', passId: expect.any(String) },
        }],
      },
    });
  });

  it('a2a.human_handoff rejects a target outside the conversation roster', async () => {
    await seedAgent();
    await seedConversation();
    const req = mockReq('POST', {
      type: 'a2a.human_handoff',
      payload: {
        conversationId: 'conv-1',
        messageId: 'message-human-unknown',
        prompt: 'Do work',
        targetAgentIds: ['not-in-project'],
      },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._json).toMatchObject({
      ok: false,
      reasonCode: 'a2a_target_not_in_roster',
    });
    const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
    expect(new AgentInbox().listPending('conv-1')).toHaveLength(0);
  });

  it('dispatch.enqueue rejects a missing conversation scope', async () => {
    const { AgentInbox } = await import('@/server/platform-events/agent-inbox');
    const req = mockReq('POST', {
      type: 'dispatch.enqueue',
      payload: { agentId: 'agent-a', prompt: 'must not use default' },
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json).toEqual({ ok: false, error: 'dispatch.enqueue requires conversationId' });
    expect(new AgentInbox().listPending('default')).toHaveLength(0);
  });

  it('rejects the removed legacy event.append mutation', async () => {
    const req = mockReq('POST', {
      type: 'event.append',
      payload: { conversationId: 'conv-1', agentId: 'agent-a', type: 'agent.text', payload: { text: 'Hello' } },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res._json.ok).toBe(false);
    expect(res._json.error).toContain('Unknown mutation type');
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
