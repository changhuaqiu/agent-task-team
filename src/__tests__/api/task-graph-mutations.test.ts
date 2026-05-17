import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import handler from '@/pages/api/task-graph';

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'conv-1', title: 'Task graph mutations' });
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('POST /api/task-graph', () => {
  it('creates a root task and returns the updated graph', async () => {
    const req = mockReq('POST', {
      action: 'createRootTask',
      conversationId: 'conv-1',
      title: 'A2A 群聊协作重构',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
    });
    const res = mockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res._json.graph.tasks).toHaveLength(1);
    expect(res._json.graph.actions[0].type).toBe('task.created');
  });

  it('splits, blocks, resumes, merges, reopens, and cancels via structured actions', async () => {
    const root = taskRepo.create({
      id: 'task-root',
      conversation_id: 'conv-1',
      title: 'Root',
      agent_id: 'planner',
    });

    const splitReq = mockReq('POST', {
      action: 'splitTask',
      conversationId: 'conv-1',
      parentTaskId: root.id,
      actorId: 'planner',
      actorType: 'agent',
      children: [
        { title: '协作模型', ownerAgentId: 'architect' },
        { title: '群聊 UI', ownerAgentId: 'frontend' },
      ],
      dependencies: [{ fromTitle: '协作模型', toTitle: '群聊 UI' }],
    });
    const splitRes = mockRes();
    await handler(splitReq, splitRes);
    expect(splitRes.statusCode).toBe(200);
    expect(splitRes._json.graph.edges).toHaveLength(3);

    const child = splitRes._json.result.children[0];
    const blockRes = mockRes();
    await handler(mockReq('POST', {
      action: 'blockTask',
      conversationId: 'conv-1',
      taskId: child.id,
      reason: '等待账号配置',
      actorId: 'architect',
      actorType: 'agent',
    }), blockRes);
    expect(blockRes._json.result.task.status).toBe('blocked');

    const resumeRes = mockRes();
    await handler(mockReq('POST', {
      action: 'resumeTask',
      conversationId: 'conv-1',
      taskId: child.id,
      actorId: 'user',
      actorType: 'user',
    }), resumeRes);
    expect(resumeRes._json.result.task.status).toBe('pending');

    taskRepo.updateStatus(splitRes._json.result.children[0].id, 'done');
    taskRepo.updateStatus(splitRes._json.result.children[1].id, 'done');
    const mergeRes = mockRes();
    await handler(mockReq('POST', {
      action: 'mergeTasks',
      conversationId: 'conv-1',
      sourceTaskIds: splitRes._json.result.children.map((task: any) => task.id),
      target: { title: '集成评审', ownerAgentId: 'reviewer' },
      actorId: 'planner',
      actorType: 'agent',
      confirmed: true,
    }), mergeRes);
    expect(mergeRes._json.result.edges).toHaveLength(2);

    const reopenRes = mockRes();
    await handler(mockReq('POST', {
      action: 'reopenTask',
      conversationId: 'conv-1',
      sourceTaskId: mergeRes._json.result.target.id,
      title: '修复评审问题',
      reason: '缺少 blocked 下一步文案',
      ownerAgentId: 'frontend',
      actorId: 'reviewer',
      actorType: 'agent',
    }), reopenRes);
    expect(reopenRes._json.result.action.type).toBe('task.reopened');

    const cancelRes = mockRes();
    await handler(mockReq('POST', {
      action: 'cancelTask',
      conversationId: 'conv-1',
      taskId: reopenRes._json.result.correctiveTask.id,
      reason: '用户暂停',
      actorId: 'user',
      actorType: 'user',
      confirmed: true,
    }), cancelRes);
    expect(cancelRes._json.result.task.status).toBe('cancelled');
  });

  it('requires confirmation for high-impact merge and cancel actions', async () => {
    const task = taskRepo.create({
      id: 'task-risky',
      conversation_id: 'conv-1',
      title: 'Risky',
      agent_id: 'planner',
    });
    const res = mockRes();

    await handler(mockReq('POST', {
      action: 'cancelTask',
      conversationId: 'conv-1',
      taskId: task.id,
      actorId: 'planner',
      actorType: 'agent',
      reason: '不做了',
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res._json.requiresConfirmation).toBe(true);
  });

  it('requires confirmation before stealing a running task owner', async () => {
    const task = taskRepo.create({
      id: 'task-owned',
      conversation_id: 'conv-1',
      title: 'Owned',
      agent_id: 'frontend',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    const res = mockRes();

    await handler(mockReq('POST', {
      action: 'assignTask',
      conversationId: 'conv-1',
      taskId: task.id,
      ownerAgentId: 'reviewer',
      actorId: 'planner',
      actorType: 'agent',
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res._json.reasonCode).toBe('task_graph.ownership_confirmation_required');
    expect(taskRepo.getById(task.id)!.agent_id).toBe('frontend');
  });

  it('assigns a task after ownership confirmation', async () => {
    const task = taskRepo.create({
      id: 'task-confirmed',
      conversation_id: 'conv-1',
      title: 'Confirmed',
      agent_id: 'frontend',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    const res = mockRes();

    await handler(mockReq('POST', {
      action: 'assignTask',
      conversationId: 'conv-1',
      taskId: task.id,
      ownerAgentId: 'reviewer',
      actorId: 'planner',
      actorType: 'agent',
      confirmed: true,
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res._json.result.task.agent_id).toBe('reviewer');
    expect(res._json.result.action.type).toBe('task.claimed');
  });

  it('returns 400 for invalid graph actions', async () => {
    const res = mockRes();

    await handler(mockReq('POST', { action: 'wat' }), res);

    expect(res.statusCode).toBe(400);
  });
});
