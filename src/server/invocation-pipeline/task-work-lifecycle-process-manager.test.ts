import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, resetDb, setTestDb } from '../db';
import type { PlatformEvent } from '../platform-events/types';
import { conversationRepo } from '../repositories/conversation-repo';
import { taskRepo } from '../repositories/task-repo';
import { TaskWorkLifecycleProcessManager } from './task-work-lifecycle-process-manager';

function workEvent(type: 'agent.work.admitted' | 'agent.work.expired'): PlatformEvent {
  return {
    schemaVersion: 1,
    category: 'coordination',
    eventId: `event-${type}`,
    type,
    projectId: 'project-1',
    streamKey: 'agent-work:project-1:luigi',
    streamSequence: 1,
    aggregate: { type: 'agent_inbox_item', id: 'inbox-1' },
    actor: { type: 'system', id: 'agent-inbox' },
    subject: { type: 'project_agent', id: 'luigi' },
    projectAgentId: 'luigi',
    inboxItemId: 'inbox-1',
    correlationId: 'project-1:TASK-1:luigi:owner_ready',
    causationId: 'wakeup-1',
    occurredAt: '2026-08-23T00:00:00.000Z',
    recordedAt: '2026-08-23T00:00:00.000Z',
    payload: {
      taskId: 'TASK-1',
      idempotencyKey: 'project-1:TASK-1:luigi:owner_ready',
      wakeup: { reasonCode: 'owner_ready' },
      ...(type === 'agent.work.expired' ? { reasonCode: 'runtime_profile_missing' } : {}),
    },
  };
}

describe('TaskWorkLifecycleProcessManager', () => {
  const emit = vi.fn();
  const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

  beforeEach(() => {
    setTestDb(createTestDb());
    conversationRepo.create({ id: 'project-1', title: 'Project' });
    const task = taskRepo.create({
      id: 'TASK-1',
      conversation_id: 'project-1',
      title: 'Implement',
      agent_id: 'luigi',
    });
    taskRepo.transition(task.id, { to: 'ready' });
    emit.mockClear();
  });

  afterEach(() => resetDb());

  it('moves a ready owned task only after the durable work reaches Runtime ACK', async () => {
    const manager = new TaskWorkLifecycleProcessManager(io);

    await manager.handle(workEvent('agent.work.admitted'), {
      signal: new AbortController().signal,
    });

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    expect(emit).toHaveBeenCalledWith('project:view', expect.objectContaining({
      type: 'task.state',
      projectId: 'project-1',
    }));
  });

  it('keeps the task ready and projects a bounded reason when Runtime start expires', async () => {
    const manager = new TaskWorkLifecycleProcessManager(io);

    await manager.handle(workEvent('agent.work.expired'), {
      signal: new AbortController().signal,
    });

    expect(taskRepo.getById('TASK-1')?.status).toBe('ready');
    expect(emit).toHaveBeenCalledWith('project:view', expect.objectContaining({
      type: 'task.wakeup',
      payload: expect.objectContaining({
        content: expect.stringContaining('runtime_profile_missing'),
        metadata: expect.objectContaining({
          executionReasonCode: 'runtime_profile_missing',
        }),
      }),
    }));
  });
});
