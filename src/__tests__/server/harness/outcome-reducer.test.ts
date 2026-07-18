import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { reduceAcceptedWakeup } from '@/server/harness/outcome-reducer';
import { readTasksMd, writeTasksMd } from '@/server/task-file-service';
import type { TaskWakeup } from '@/server/task-flow/task-wakeup';

let projectPath: string;

beforeEach(() => {
  setTestDb(createTestDb());
  conversationRepo.create({ id: 'conv-1', title: 'Harness' });
  projectPath = join(tmpdir(), `ath-harness-reducer-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(projectPath, { recursive: true });
});
afterEach(() => {
  rmSync(projectPath, { recursive: true, force: true });
  resetDb();
});

function wakeup(reasonCode: 'owner_ready' | 'dependency_resolved' | 'review_requested'): TaskWakeup {
  return {
    conversationId: 'conv-1',
    taskId: 'TASK-1',
    agentId: 'luigi',
    reasonCode,
    dispatchSource: reasonCode === 'review_requested' ? 'review_gate' : 'workflow',
    prompt: 'Continue',
    content: 'Continue',
    metadata: {
      taskId: 'TASK-1',
      taskTitle: 'Server loop',
      taskStatus: 'pending',
      ownerAgentId: 'luigi',
      reasonCode,
      idempotencyKey: `conv-1:TASK-1:luigi:${reasonCode}`,
      startsA2AHandoff: false,
      startsDispatch: true,
    },
  };
}

describe('Harness outcome reducer', () => {
  it('moves only an accepted ready owner from pending to in_progress', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    taskRepo.update('TASK-1', { work_dir: projectPath });
    writeTasksMd(projectPath, [{
      id: 'TASK-1',
      title: 'Server loop',
      phase: '',
      role: 'worker',
      agent: 'luigi',
      status: 'pending',
      depends: [],
      deliverable: '',
    }]);
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    expect(readTasksMd(projectPath).tasks[0].status).toBe('in_progress');
    expect(emit).toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'TASK-1',
      actorId: 'platform-harness',
    }));
    expect(emit).not.toHaveBeenCalledWith('task.sync_error', expect.anything());
  });

  it('does not infer review or done transitions from runtime acceptance', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    const io = { to: vi.fn(() => ({ emit: vi.fn() })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('review_requested'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('pending');
  });

  it('keeps an accepted transition observable when its runtime path is missing', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    const failures = proofLogRepo.findByType({
      eventType: 'task_graph.runtime_projection.failed',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      reasonCode: 'runtime_projection_failed',
    });
    expect(JSON.parse(failures[0].metadata ?? '{}')).toMatchObject({
      failureCause: 'work_dir_missing',
      status: 'in_progress',
    });
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskId: 'TASK-1',
      reasonCode: 'runtime_projection_failed',
    }));
    expect(emit).toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'TASK-1',
      actorId: 'platform-harness',
    }));
  });
});
