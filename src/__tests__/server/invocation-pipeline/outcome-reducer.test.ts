// Invocation Pipeline outcome reducer tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server as IOServer } from 'socket.io';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { taskCommandService } from '@/server/repositories/task-command-service';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import {
  PROJECTION_ERROR_MESSAGE_LIMIT,
  reduceAcceptedWakeup,
  sanitizeProjectionErrorMessage,
} from '@/server/invocation-pipeline/outcome-reducer';
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
      taskStatus: 'ready',
      ownerAgentId: 'luigi',
      reasonCode,
      idempotencyKey: `conv-1:TASK-1:luigi:${reasonCode}`,
      startsA2AHandoff: false,
      startsDispatch: true,
    },
  };
}

describe('Invocation Pipeline outcome reducer', () => {
  function projectionFailures() {
    return proofLogRepo.findByType({
      eventType: 'task_graph.runtime_projection.failed',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      reasonCode: 'runtime_projection_failed',
    });
  }

  function singleProjectionFailure() {
    const failures = projectionFailures();
    expect(failures).toHaveLength(1);
    return failures[0];
  }

  it('moves only an accepted ready owner to in_progress', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    taskCommandService.recordProjectionLocation({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      workDir: projectPath,
    });
    writeTasksMd(projectPath, [{
      id: 'TASK-1',
      title: 'Server loop',
      phase: '',
      role: 'worker',
      agent: 'luigi',
      status: 'ready',
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

    expect(taskRepo.getById('TASK-1')?.status).toBe('ready');
  });

  it('keeps an accepted transition observable when its runtime path is missing', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    expect(JSON.parse(singleProjectionFailure().metadata ?? '{}')).toMatchObject({
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

  it('ignores an accepted wakeup whose task no longer exists', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')).toBeUndefined();
    expect(projectionFailures()).toHaveLength(0);
    expect(io.to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('records a missing runtime task entry without rolling back the accepted transition', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    taskCommandService.recordProjectionLocation({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      workDir: projectPath,
    });
    writeTasksMd(projectPath, [{
      id: 'TASK-OTHER',
      title: 'Other task',
      phase: '',
      role: 'worker',
      agent: 'luigi',
      status: 'ready',
      depends: [],
      deliverable: '',
    }]);
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    expect(readTasksMd(projectPath).tasks).toEqual([
      expect.objectContaining({ id: 'TASK-OTHER', status: 'ready' }),
    ]);
    expect(JSON.parse(singleProjectionFailure().metadata ?? '{}')).toMatchObject({
      failureCause: 'task_entry_missing',
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

  it('records a stable I/O failure cause without rolling back the accepted transition', async () => {
    taskRepo.create({ id: 'TASK-1', conversation_id: 'conv-1', title: 'Server loop', agent_id: 'luigi' });
    taskCommandService.recordProjectionLocation({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      workDir: projectPath,
    });
    mkdirSync(join(projectPath, '.ath', 'TASKS.md'), { recursive: true });
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })) } as unknown as IOServer;

    await reduceAcceptedWakeup(io, wakeup('owner_ready'));

    expect(taskRepo.getById('TASK-1')?.status).toBe('in_progress');
    expect(JSON.parse(singleProjectionFailure().metadata ?? '{}')).toMatchObject({
      failureCause: 'io_error',
      status: 'in_progress',
      errorMessage: expect.any(String),
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

  it('bounds and normalizes durable projection error messages', () => {
    const message = sanitizeProjectionErrorMessage(
      new Error(`${'x'.repeat(PROJECTION_ERROR_MESSAGE_LIMIT + 100)}\r\nsecret-tail`),
    );

    expect(message).toHaveLength(PROJECTION_ERROR_MESSAGE_LIMIT);
    expect(message).not.toMatch(/[\r\n\t]/);
    expect(message).not.toContain('secret-tail');
  });
});
