import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { taskGraphRepo } from '@/server/repositories/task-graph-repo';
import { groupChatTaskFlow } from '@/server/task-flow/group-chat-task-flow';

let db: Database.Database;
let mutationSequence = 0;

function mutationMeta() {
  return {
    expectedRevision: taskGraphRepo.revision('conv-1'),
    idempotencyKey: `group-chat-flow-test:${++mutationSequence}`,
  };
}

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
  resetSeq();
  mutationSequence = 0;
  conversationRepo.create({ id: 'conv-1', title: 'Group Chat Flow' });
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('groupChatTaskFlow', () => {
  it('creates a root task from a group-chat message and binds the message', () => {
    const messageId = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'human',
      senderId: 'user',
      content: '请帮我重构 A2A 群聊协作。',
    });

    const result = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: 'A2A 群聊协作重构',
      description: '让多 agent 协作以群聊形式存在。',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
      messageId,
    });

    expect(result.task.id).toMatch(/^task-/);
    expect(result.task.status).toBe('ready');
    expect(result.task.agent_id).toBe('planner');
    expect(result.action.type).toBe('task.created');

    const graph = taskGraphRepo.getGraph('conv-1');
    expect(graph.tasks.map((task) => task.id)).toEqual([result.task.id]);
    expect(graph.bindings.map((binding) => binding.message_id)).toEqual([messageId]);
    expect(graph.bindings[0].action_id).toBe(result.action.id);
  });

  it('splits one task into children and dependency edges from one chat action', () => {
    const root = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: 'A2A 群聊协作重构',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;
    const messageId = messageRepo.append({
      conversationId: 'conv-1',
      senderType: 'agent',
      senderId: 'planner',
      content: '我把任务拆成模型、UI、测试三条线。',
    });

    const split = groupChatTaskFlow.splitTask({
      conversationId: 'conv-1',
      parentTaskId: root.id,
      actorId: 'planner',
      actorType: 'agent',
      ...mutationMeta(),
      messageId,
      children: [
        { title: '协作模型', ownerAgentId: 'architect' },
        { title: '群聊 UI', ownerAgentId: 'frontend', dependsOnTaskIds: [] },
        { title: '测试验证', ownerAgentId: 'tester' },
      ],
      dependencies: [
        { fromTitle: '协作模型', toTitle: '群聊 UI' },
        { fromTitle: '群聊 UI', toTitle: '测试验证' },
      ],
    });

    expect(split.children.map((task) => task.title)).toEqual(['协作模型', '群聊 UI', '测试验证']);
    expect(split.action.type).toBe('task.split');

    const graph = taskGraphRepo.getGraph('conv-1');
    const subtaskEdges = graph.edges.filter((edge) => edge.type === 'subtask_of');
    const dependencyEdges = graph.edges.filter((edge) => edge.type === 'depends_on');

    expect(subtaskEdges).toHaveLength(3);
    expect(dependencyEdges).toHaveLength(2);
    expect(graph.bindings.filter((binding) => binding.message_id === messageId)).toHaveLength(4);
  });

  it('merges completed branches into an integration task without deleting sources', () => {
    const root = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: 'Root',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;
    const split = groupChatTaskFlow.splitTask({
      conversationId: 'conv-1',
      parentTaskId: root.id,
      actorId: 'planner',
      actorType: 'agent',
      ...mutationMeta(),
      children: [
        { title: '协作模型', ownerAgentId: 'architect' },
        { title: '群聊 UI', ownerAgentId: 'frontend' },
      ],
    });

    for (const task of split.children) {
      taskRepo.transition(task.id, { to: 'in_progress' });
      taskRepo.transition(task.id, { to: 'in_review' });
      taskRepo.transition(task.id, { to: 'done' });
    }

    const merged = groupChatTaskFlow.mergeTasks({
      conversationId: 'conv-1',
      sourceTaskIds: split.children.map((task) => task.id),
      target: {
        title: 'A2A 群聊闭环评审',
        ownerAgentId: 'reviewer',
      },
      actorId: 'planner',
      actorType: 'agent',
      ...mutationMeta(),
    });

    expect(merged.target.title).toBe('A2A 群聊闭环评审');
    expect(merged.target.status).toBe('ready');
    expect(merged.edges).toHaveLength(2);
    expect(split.children.map((task) => taskRepo.getById(task.id)!.status)).toEqual(['done', 'done']);
    expect(taskGraphRepo.getGraph('conv-1').tasks).toHaveLength(4);
  });

  it('creates a corrective task when review reopens completed work', () => {
    const source = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: '群聊 UI',
      ownerAgentId: 'frontend',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;
    taskRepo.transition(source.id, { to: 'in_progress' });
    taskRepo.transition(source.id, { to: 'in_review' });
    taskRepo.transition(source.id, { to: 'done' });

    const reopened = groupChatTaskFlow.reopenTask({
      conversationId: 'conv-1',
      sourceTaskId: source.id,
      title: '修复群聊 UI 任务胶囊状态',
      reason: '评审发现 blocked 状态没有可执行下一步。',
      ownerAgentId: 'frontend',
      actorId: 'reviewer',
      actorType: 'agent',
      ...mutationMeta(),
    });

    expect(reopened.correctiveTask.status).toBe('ready');
    expect(reopened.action.type).toBe('task.reopened');
    expect(reopened.edge.type).toBe('reopens');
    expect(reopened.edge.from_task_id).toBe(reopened.correctiveTask.id);
    expect(reopened.edge.to_task_id).toBe(source.id);
  });

  it('blocks and resumes a task with structured actions', () => {
    const task = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: '接入 A2A 任务图',
      ownerAgentId: 'backend',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;

    const blocked = groupChatTaskFlow.blockTask({
      conversationId: 'conv-1',
      taskId: task.id,
      reason: '目标 Agent 未配置账号。',
      actorId: 'backend',
      actorType: 'agent',
      ...mutationMeta(),
    });

    expect(blocked.task.status).toBe('blocked');
    expect(blocked.action.type).toBe('task.blocked');
    expect(JSON.parse(blocked.action.payload)).toMatchObject({ reason: '目标 Agent 未配置账号。' });

    const resumed = groupChatTaskFlow.resumeTask({
      conversationId: 'conv-1',
      taskId: task.id,
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    });

    expect(resumed.task.status).toBe('ready');
    expect(resumed.action.type).toBe('task.resumed');
  });

  it('assigns a task through a structured claim action', () => {
    const task = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: '派给前端',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;

    const assigned = groupChatTaskFlow.assignTask({
      conversationId: 'conv-1',
      taskId: task.id,
      ownerAgentId: 'frontend',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    });

    expect(assigned.task.agent_id).toBe('frontend');
    expect(assigned.action.type).toBe('task.claimed');
    expect(JSON.parse(assigned.action.payload)).toMatchObject({
      previousOwnerAgentId: 'planner',
      ownerAgentId: 'frontend',
    });
  });

  it('cancels a task without deleting its history', () => {
    const task = groupChatTaskFlow.createRootTask({
      conversationId: 'conv-1',
      title: '废弃方案',
      ownerAgentId: 'planner',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    }).task;

    const cancelled = groupChatTaskFlow.cancelTask({
      conversationId: 'conv-1',
      taskId: task.id,
      reason: '用户选择了新的信息架构。',
      actorId: 'user',
      actorType: 'user',
      ...mutationMeta(),
    });

    expect(cancelled.task.status).toBe('cancelled');
    expect(cancelled.action.type).toBe('task.cancelled');
    expect(taskGraphRepo.listActionsForTask(task.id).map((action) => action.type)).toEqual([
      'task.created',
      'task.cancelled',
    ]);
  });
});
