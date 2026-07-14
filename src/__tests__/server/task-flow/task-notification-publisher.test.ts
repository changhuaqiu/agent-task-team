import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { seedPresetAgents } from '@/server/db/seed-agents';
import { publishTaskChangeNotification, publishTaskNotification } from '@/server/task-flow/task-notification-publisher';

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'conv-1', title: 'Notifications' });
});

afterEach(() => {
  resetDb();
  resetSeq();
});

describe('publishTaskNotification', () => {
  it('persists a system notification and emits it to the conversation room', () => {
    const previousTask = taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'A2A 后端修复',
      agent_id: 'toad',
    });
    taskRepo.updateStatus(previousTask.id, 'in_review', 'PASS-WITH-NOTES');
    const task = taskRepo.getById(previousTask.id)!;

    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to, emit: vi.fn() } as unknown as IOServer;

    const notification = publishTaskNotification({
      io,
      kind: 'task.status_changed',
      task,
      previousTask,
      actorId: 'peach',
      actorType: 'agent',
      recipients: ['toad', 'mario'],
      changedFields: ['status', 'review_note'],
    });

    expect(notification?.id).toMatch(/^msg-/);
    expect(to).toHaveBeenCalledWith('conv-1');
    expect(emit).toHaveBeenCalledWith('task.notification', expect.objectContaining({
      id: notification?.id,
      conversationId: 'conv-1',
      taskId: 'TASK-003',
      recipients: ['toad', 'mario'],
    }));

    const messages = messageRepo.getByConversation('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sender_type: 'system',
      sender_id: 'task-notifier',
      task_id: 'TASK-003',
      intent: 'task_status',
    });
    expect(JSON.parse(messages[0].mentions ?? '[]')).toEqual(['toad', 'mario']);
    expect(JSON.parse(messages[0].metadata ?? '{}')).toMatchObject({
      startsA2AHandoff: false,
      recipients: ['toad', 'mario'],
    });
  });

  it('publishes a wakeup when a task has a clear ready owner', () => {
    const previousTask = taskRepo.create({
      id: 'TASK-008',
      conversation_id: 'conv-1',
      title: 'Execution Adapter',
      agent_id: 'toad',
    });
    taskRepo.updateStatus(previousTask.id, 'blocked');
    const blocked = taskRepo.getById(previousTask.id)!;
    taskRepo.updateStatus(previousTask.id, 'pending');
    const ready = taskRepo.getById(previousTask.id)!;

    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to, emit: vi.fn() } as unknown as IOServer;

    publishTaskChangeNotification({
      io,
      kind: 'task.status_changed',
      task: ready,
      previousTask: blocked,
      actorId: 'system',
      actorType: 'system',
      changedFields: ['status'],
    });

    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'TASK-008',
      agentId: 'toad',
      reasonCode: 'owner_ready',
      dispatchSource: 'workflow',
    }));

    const messages = messageRepo.getByConversation('conv-1');
    expect(messages.some((message) => message.sender_id === 'task-wakeup')).toBe(true);
  });

  it('publishes a coordinator wakeup when a reviewer submits a review decision', () => {
    seedPresetAgents();
    const task = taskRepo.create({
      id: 'TASK-009',
      conversation_id: 'conv-1',
      title: 'Review gate callback',
      agent_id: 'toad',
    });
    taskRepo.updateStatus(task.id, 'in_review');
    const previous = taskRepo.getById(task.id)!;
    taskRepo.updateStatus(task.id, 'in_review', 'PASS: DK review approved');
    const reviewed = taskRepo.getById(task.id)!;

    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const io = { to, emit: vi.fn() } as unknown as IOServer;

    publishTaskChangeNotification({
      io,
      kind: 'task.status_changed',
      task: reviewed,
      previousTask: previous,
      actorId: 'dk',
      actorType: 'agent',
      changedFields: ['review_note'],
    });

    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'TASK-009',
      agentId: 'mario',
      reasonCode: 'review_decision_ready',
      dispatchSource: 'review_gate',
    }));
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      taskId: 'TASK-009',
      agentId: 'peach',
      reasonCode: 'test_requested',
      dispatchSource: 'test_gate',
    }));

    const wakeupMessages = messageRepo.getByConversation('conv-1')
      .filter((message) => message.sender_id === 'task-wakeup');
    expect(wakeupMessages).toHaveLength(2);
    expect(wakeupMessages.map((message) => JSON.parse(message.metadata ?? '{}').reasonCode))
      .toEqual(expect.arrayContaining(['review_decision_ready', 'test_requested']));
    for (const message of wakeupMessages) {
      expect(JSON.parse(message.metadata ?? '{}')).toMatchObject({
        startsA2AHandoff: false,
        startsDispatch: true,
      });
    }
  });

  it('skips publish when there are no related recipients', () => {
    const task = taskRepo.create({
      id: 'TASK-001',
      conversation_id: 'conv-1',
      title: 'Solo task',
      agent_id: 'mario',
    });
    const io = { to: vi.fn(), emit: vi.fn() } as unknown as IOServer;

    const notification = publishTaskNotification({
      io,
      kind: 'task.updated',
      task,
      actorId: 'mario',
      recipients: [],
    });

    expect(notification).toBeNull();
    expect(messageRepo.getByConversation('conv-1')).toHaveLength(0);
    expect(io.to).not.toHaveBeenCalled();
  });
});
