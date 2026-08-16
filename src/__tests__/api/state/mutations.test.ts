import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

async function seedTeamPackConversation(firstWorkflowRole: string | null = 'planner') {
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
      steps: firstWorkflowRole === null
        ? []
        : [
            { role: firstWorkflowRole, action: 'plan', output: 'plan' },
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

  it.each([
    'task.delete',
    'session.create',
    'session.updateCliSessionId',
    'session.seal',
    'session.sealByTask',
    'invocation.create',
    'invocation.transition',
    'phase.upsert',
    'phase.delete',
    'tool.invoke',
    'dispatch.enqueue',
    'dispatch.cancel',
  ])('rejects retired browser-owned mutation %s', async (type) => {
    const res = mockRes();
    await handler(mockReq('POST', { type, payload: {} }), res);
    expect(res.statusCode).toBe(400);
    expect(res._json).toEqual({ ok: false, error: `Unknown mutation type: ${type}` });
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

  it('task.create requests execution through the server wakeup pipeline', async () => {
    await seedConversation();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const req = mockReq('POST', {
      type: 'task.create',
      payload: {
        id: 'task-start-on-create',
        conversation_id: 'conv-1',
        title: 'Start through server owner',
        agent_id: 'agent-a',
        requestExecution: true,
      },
    });
    const res = mockRes();
    res.socket = { server: { io: { to, emit: vi.fn() } } };

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-start-on-create',
      agentId: 'agent-a',
      reasonCode: 'owner_ready',
    }));
  });

  it('task.create assigns a TeamPack task from TeamRuntime initialAgentId when no explicit agent is supplied', async () => {
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

  it('task.create falls back to the first runtime role when the workflow role is unavailable', async () => {
    await seedTeamPackConversation(null);
    const req = mockReq('POST', {
      type: 'task.create',
      payload: { id: 'task-team-roster', conversation_id: 'conv-team', title: 'Use the runtime roster' },
    });
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.result.agent_id).toBe('coder');
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

  it('task.create preserves an explicit agent instead of overriding with TeamRuntime initialAgentId', async () => {
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

  it('task.updateStatus changes status', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_progress', expectedTaskRevision: 0 },
    });
    const res = mockRes();
    res.socket = { server: { io: { to, emit: vi.fn() } } };
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.ok).toBe(true);
    expect(res._json.result.id).toBe('task-1');
    expect(res._json.result.status).toBe('in_progress');

    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-1')!.status).toBe('in_progress');
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-1',
      agentId: 'agent-a',
      reasonCode: 'owner_ready',
    }));
  });

  it('task.updateStatus rejects a stale browser revision instead of overwriting newer facts', async () => {
    await seedTask();
    const first = mockRes();
    await handler(mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_progress',
        expectedTaskRevision: 0,
        idempotencyKey: 'status-revision-1',
      },
    }), first);
    const stale = mockRes();
    await handler(mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'blocked',
        expectedTaskRevision: 0,
        idempotencyKey: 'status-revision-stale',
      },
    }), stale);

    expect(first.statusCode).toBe(200);
    expect(stale.statusCode).toBe(409);
    expect(stale._json.reasonCode).toBe('stale_task_revision');
    const { taskRepo } = await import('@/server/repositories/task-repo');
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_progress', revision: 1 });
  });

  it('admits the task revision before evidence recovery side effects', async () => {
    await seedTask();
    const { taskRepo } = await import('@/server/repositories/task-repo');
    taskRepo.transition('task-1', { to: 'in_progress' });
    const submit = vi.fn(() => ({
      handled: true,
      disposition: 'accepted' as const,
      completion: new Promise<never>(() => {}),
    }));
    const to = vi.fn(() => ({ emit: vi.fn() }));
    const io = { to };
    const { registerInvocationCoordinator } = await import('@/server/invocation-pipeline/registry');
    registerInvocationCoordinator(io as never, { submit } as never);
    const res = mockRes();
    res.socket = { server: { io } };

    await handler(mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        expectedTaskRevision: 0,
        actorId: 'agent-a',
        actorType: 'agent',
      },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res._json.reasonCode).toBe('stale_task_revision');
    expect(submit).not.toHaveBeenCalled();
    expect(to).not.toHaveBeenCalled();
  });

  it('requires a task revision for browser-owned task mutations', async () => {
    await seedTask();
    const statusRes = mockRes();
    await handler(mockReq('POST', {
      type: 'task.updateStatus',
      payload: { id: 'task-1', status: 'in_progress' },
    }), statusRes);
    const updateRes = mockRes();
    await handler(mockReq('POST', {
      type: 'task.update',
      payload: { id: 'task-1', title: 'Stale title' },
    }), updateRes);

    expect(statusRes.statusCode).toBe(400);
    expect(statusRes._json.reasonCode).toBe('task_revision_required');
    expect(updateRes.statusCode).toBe(400);
    expect(updateRes._json.reasonCode).toBe('task_revision_required');
  });

  it('task.updateStatus replays the frozen result when the first HTTP response is lost', async () => {
    await seedTask();
    const body = {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_progress',
        expectedTaskRevision: 0,
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
        expectedTaskRevision: 1,
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
        expectedTaskRevision: 1,
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
    const io = { to };
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        expectedTaskRevision: 0,
        actorId: 'agent-a',
        actorType: 'agent',
        idempotencyKey: 'evidence-recovery-1',
      },
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
    const { getDb } = await import('@/server/db');
    expect(getDb().prepare(`
      SELECT project_id,project_agent_id,idempotency_key,command_json
      FROM agent_inbox_item
    `).all()).toEqual([expect.objectContaining({
      project_id: 'conv-1',
      project_agent_id: 'agent-a',
      idempotency_key: 'task-evidence-recovery:evidence-recovery-1',
      command_json: expect.stringContaining('"contextScenario":"recovery"'),
    })]);
  });

  it('routes WebUI evidence recovery to the Task owner when actorId is omitted', async () => {
    await seedTask();
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to };
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        expectedTaskRevision: 0,
        idempotencyKey: 'evidence-recovery-owner',
      },
    });
    const res = mockRes();
    res.socket = { server: { io } };

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'task-1',
      agentId: 'agent-a',
      reasonCode: 'missing_implementation_evidence',
    }));
    const { getDb } = await import('@/server/db');
    expect(getDb().prepare(`
      SELECT project_agent_id FROM agent_inbox_item
      WHERE idempotency_key='task-evidence-recovery:evidence-recovery-owner'
    `).get()).toEqual({ project_agent_id: 'agent-a' });
  });

  it('replays a persisted evidence rejection without dispatching recovery twice', async () => {
    await seedTask();
    const body = {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        expectedTaskRevision: 0,
        actorId: 'agent-a',
        actorType: 'agent',
        idempotencyKey: 'evidence-recovery-replay',
      },
    };
    const firstEmit = vi.fn();
    const first = mockRes();
    first.socket = { server: { io: { to: vi.fn(() => ({ emit: firstEmit })) } } };
    await handler(mockReq('POST', body), first);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    taskRepo.transition('task-1', { to: 'in_progress' });
    const replayEmit = vi.fn();
    const replay = mockRes();
    replay.socket = { server: { io: { to: vi.fn(() => ({ emit: replayEmit })) } } };
    await handler(mockReq('POST', body), replay);

    expect(first.statusCode).toBe(403);
    expect(replay.statusCode).toBe(403);
    expect(replay._json).toEqual(first._json);
    expect(firstEmit).toHaveBeenCalledTimes(1);
    expect(replayEmit).not.toHaveBeenCalled();
    const { getDb } = await import('@/server/db');
    expect(getDb().prepare(`
      SELECT COUNT(*) count FROM agent_inbox_item
      WHERE idempotency_key='task-evidence-recovery:evidence-recovery-replay'
    `).get()).toEqual({ count: 1 });
  });

  it('replays a persisted evidence rejection after the Task and Delivery are deleted', async () => {
    await seedTask();
    const body = {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1',
        status: 'in_review',
        expectedTaskRevision: 0,
        actorId: 'agent-a',
        actorType: 'agent',
        idempotencyKey: 'evidence-recovery-deleted-aggregate',
      },
    };
    const first = mockRes();
    first.socket = { server: { io: { to: vi.fn(() => ({ emit: vi.fn() })) } } };
    await handler(mockReq('POST', body), first);

    const deleted = mockRes();
    await handler(mockReq('POST', {
      type: 'conversation.delete',
      payload: { id: 'conv-1' },
    }), deleted);

    const replay = mockRes();
    replay.socket = { server: { io: { to: vi.fn(() => ({ emit: vi.fn() })) } } };
    await handler(mockReq('POST', body), replay);

    expect(first.statusCode).toBe(403);
    expect(deleted._json).toEqual({ ok: true, result: { id: 'conv-1', deleted: true } });
    expect(replay.statusCode).toBe(403);
    expect(replay._json).toEqual(first._json);
    const { getDb } = await import('@/server/db');
    expect(getDb().prepare(`
      SELECT conversation_id,task_id FROM task_command_rejection_receipt
      WHERE idempotency_key='evidence-recovery-deleted-aggregate'
    `).get()).toEqual({ conversation_id: 'conv-1', task_id: 'task-1' });
  });

  it('task.updateStatus cannot fabricate done for a Git-backed task', async () => {
    await seedTask();
    const { conversationRepo } = await import('@/server/repositories/conversation-repo');
    conversationRepo.update('conv-1', { git_repo_root: 'C:/repo' });
    const req = mockReq('POST', {
      type: 'task.updateStatus',
      payload: {
        id: 'task-1', status: 'done', expectedTaskRevision: 0, actorId: 'mario', actorType: 'agent',
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
        expectedTaskRevision: 2,
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
      payload: { id: 'task-1', title: 'Renamed', description: 'Updated desc', expectedTaskRevision: 0 },
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
        expectedTaskRevision: 0,
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
      payload: { id: 'task-1', agentId: 'agent-b', expectedTaskRevision: 0, actorId: 'planner', actorType: 'agent' },
    });
    const res = mockRes();
    res.socket = { server: { io: { to: vi.fn(() => ({ emit })), emit: vi.fn() } } };

    await handler(req, res);

    const { taskRepo } = await import('@/server/repositories/task-repo');
    const { messageRepo } = await import('@/server/repositories/message-repo');
    expect(taskRepo.getById('task-1')!.agent_id).toBe('agent-b');
    expect(JSON.parse(messageRepo.getByConversation('conv-1')[0].mentions ?? '[]')).toEqual(['agent-b', 'agent-a']);
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
