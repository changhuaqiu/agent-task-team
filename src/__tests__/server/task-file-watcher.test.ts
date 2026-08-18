import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { upsertAgent } from '@/server/db/agentQueries';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { invocationRepo } from '@/server/repositories/invocation-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { taskGraphRepo } from '@/server/repositories/task-graph-repo';
import { ensureTasksMdProjection, readTasksMd } from '@/server/task-file-service';
import { startTaskWatcher, syncTasksToDb } from '@/server/task-file-watcher';
import { WorkContractRepository } from '@/server/work-contract/repository';
import type { Server as IOServer } from 'socket.io';

let projectPath: string;
let watcherCleanups: Array<() => void>;

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  watcherCleanups = [];
  conversationRepo.create({ id: 'conv-1', title: 'Watcher Conv' });
  projectPath = join(tmpdir(), `ath-task-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'runtime-dir');
  mkdirSync(join(projectPath, '.ath'), { recursive: true });
});

afterEach(() => {
  for (const cleanup of watcherCleanups.reverse()) cleanup();
  rmSync(projectPath, { recursive: true, force: true });
  resetDb();
  resetSeq();
});

function watchTasks(conversationId: string, io: IOServer): () => void {
  const cleanup = startTaskWatcher(projectPath, conversationId, io);
  watcherCleanups.push(cleanup);
  return cleanup;
}

function writeTasksMd(status: string, deliverable = '-'): void {
  writeFileSync(join(projectPath, '.ath', 'TASKS.md'), `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-003 | 修复 A2A 通知 | P1 | backend | toad | ${status} | - | ${deliverable} |
`, 'utf-8');
}

describe('syncTasksToDb', () => {
  it('throws in strict mode so a durable task-sync effect can retry', () => {
    writeTasksMd('doing');
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    const create = vi.spyOn(taskRepo, 'create')
      .mockImplementationOnce(() => {
        throw new Error('temporary database failure');
      });

    expect(() => syncTasksToDb(
      projectPath,
      'conv-1',
      io as unknown as IOServer,
      { throwOnError: true },
    )).toThrow('task_sync_failed:1');
    expect(taskRepo.getById('TASK-003')).toBeUndefined();
    create.mockRestore();
  });

  it('projects TASKS.md when the watched file is created for the first time', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    watchTasks('conv-1', io as unknown as IOServer);
    await new Promise(resolve => setTimeout(resolve, 100));
    writeTasksMd('doing');

    const deadline = Date.now() + 5_000;
    while (!taskRepo.getById('TASK-003') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      conversation_id: 'conv-1',
      status: 'in_progress',
      agent_id: 'toad',
    });
  });

  it('does not let a duplicate start cleanup close the existing watcher', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    watchTasks('conv-1', io as unknown as IOServer);
    const duplicateCleanup = watchTasks('conv-1', io as unknown as IOServer);
    duplicateCleanup();
    await new Promise(resolve => setTimeout(resolve, 100));
    writeTasksMd('doing');

    const deadline = Date.now() + 5_000;
    while (!taskRepo.getById('TASK-003') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      conversation_id: 'conv-1',
      status: 'in_progress',
    });
  });

  it('reprojects an existing TASKS.md when the watcher starts after a restart', async () => {
    upsertAgent({
      id: 'peach',
      name: 'Peach',
      roleCardId: 'preset-code-reviewer',
      theme: 'peach',
      emoji: '🌸',
    });
    writeTasksMd('todo', 'queued.md');
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    watchTasks('conv-1', io as unknown as IOServer);

    const deadline = Date.now() + 5_000;
    while (!taskRepo.getById('TASK-003') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'ready',
      description: 'queued.md',
    });
    expect(emit).toHaveBeenCalledWith('task.sync', expect.objectContaining({
      conversationId: 'conv-1',
      tasks: [expect.objectContaining({ id: 'TASK-003', status: 'ready' })],
    }));
  });

  it('publishes task notifications when TASKS.md changes status or deliverable', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      description: '',
      agent_id: 'toad',
    });
    taskRepo.transition('TASK-003', { to: 'in_progress' });
    writeTasksMd('review', 'src/server/task-flow/task-notifications.ts');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    const updated = taskRepo.getById('TASK-003')!;
    expect(updated.status).toBe('in_review');
    expect(updated.description).toBe('src/server/task-flow/task-notifications.ts');

    const messages = messageRepo.getByConversation('conv-1');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('@toad');
    expect(JSON.parse(messages[0].metadata ?? '{}')).toMatchObject({
      startsA2AHandoff: false,
      taskId: 'TASK-003',
      changedFields: ['status', 'description'],
    });
    expect(io.to).toHaveBeenCalledWith('conv-1');
    expect(emit).toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'TASK-003',
      recipients: ['toad'],
    }));
  });

  it('transfers a shared runtime projection without importing the prior Conversation tasks', async () => {
    conversationRepo.create({ id: 'conv-other', title: 'Other watcher conversation' });
    const emitOne = vi.fn();
    const emitOther = vi.fn();
    const ioOne = { to: vi.fn(() => ({ emit: emitOne })), emit: vi.fn() };
    const ioOther = { to: vi.fn(() => ({ emit: emitOther })), emit: vi.fn() };

    taskRepo.create({
      id: 'TASK-ONE', conversation_id: 'conv-1', title: 'First delivery', agent_id: 'mario',
    });
    ensureTasksMdProjection(projectPath, 'conv-1', taskRepo.getByConversation('conv-1'));
    watchTasks('conv-1', ioOne as unknown as IOServer);
    taskRepo.create({
      id: 'TASK-TWO', conversation_id: 'conv-other', title: 'Second delivery', agent_id: 'luigi',
    });
    ensureTasksMdProjection(projectPath, 'conv-other', taskRepo.getByConversation('conv-other'));
    watchTasks('conv-other', ioOther as unknown as IOServer);

    writeFileSync(join(projectPath, '.ath', 'TASKS.md'), `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-TWO | Second delivery | P1 | worker | luigi | doing | - | result.md |
`, 'utf-8');
    const deadline = Date.now() + 5_000;
    while (taskRepo.getById('TASK-TWO')?.status !== 'in_progress' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(ioOther.to).toHaveBeenCalledWith('conv-other');
    expect(taskRepo.getByConversation('conv-1').map((task) => task.id)).toEqual(['TASK-ONE']);
    expect(taskRepo.getByConversation('conv-other')).toEqual([
      expect.objectContaining({ id: 'TASK-TWO', status: 'in_progress', description: 'result.md' }),
    ]);
  }, 15_000);

  it('keeps WorkContract-managed status authoritative over a stale TASKS.md row', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Review exact revision',
      description: 'authoritative.md',
      agent_id: 'mario',
    });
    taskRepo.transition('TASK-003', { to: 'in_progress' });
    taskRepo.transition('TASK-003', { to: 'in_review' });
    const before = taskRepo.getById('TASK-003')!;
    new WorkContractRepository().issue({
      workId: 'task:TASK-003:agent:mario:purpose:execute',
      attemptId: 'attempt-managed-file-projection',
      projectId: 'conv-1',
      taskId: 'TASK-003',
      agentId: 'mario',
      goal: 'Deliver exact review revision',
      acceptanceCriteria: ['reviewed'],
      role: { name: 'planner' },
      permissions: {},
      authoritativeRefs: ['task:TASK-003'],
      authoritativeRevisions: { task: before.revision },
      contextSnapshotRef: 'ctx-managed-file-projection',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-managed-file-projection',
      causationId: 'trigger-managed-file-projection',
    });
    writeTasksMd('doing', 'stale projection');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'in_review',
      revision: before.revision,
      description: 'authoritative.md',
    });
    expect(readTasksMd(projectPath).tasks[0]).toMatchObject({
      status: 'in_review',
      deliverable: 'authoritative.md',
    });
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.transition.blocked',
      conversationId: 'conv-1',
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_managed_work',
    })).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_managed_work',
    }));
  });

  it('rejects Git quality-gate transitions written directly to TASKS.md', () => {
    conversationRepo.update('conv-1', { git_repo_root: projectPath });
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      agent_id: 'toad',
    });
    taskRepo.transition('TASK-003', { to: 'in_progress' });
    writeTasksMd('review', 'attempted bypass');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'in_progress',
      description: 'attempted bypass',
    });
    expect(readTasksMd(projectPath).tasks[0].status).toBe('in_progress');
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.gate_evidence.blocked',
      conversationId: 'conv-1',
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_gate_bypass',
    })).toHaveLength(1);
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_gate_bypass',
    }));
  });

  it('does not let a stale file roll a Git receipt state backward', () => {
    conversationRepo.update('conv-1', { git_repo_root: projectPath });
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Keep receipt state',
      agent_id: 'toad',
    });
    taskRepo.transition('TASK-003', { to: 'in_progress' });
    taskRepo.transition('TASK-003', { to: 'in_review' });
    taskGraphRepo.appendAction({
      conversationId: 'conv-1',
      actorId: 'luigi',
      actorType: 'agent',
      type: 'task.pull_request_submitted',
      taskIds: ['TASK-003'],
      payload: { receipt: { headSha: 'abc123' } },
    });
    writeTasksMd('doing', 'stale runtime projection');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')?.status).toBe('in_review');
    expect(readTasksMd(projectPath).tasks[0].status).toBe('in_review');
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_gate_bypass',
    }));
  });

  it('does not let a stale todo file regress a task with an active invocation', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      agent_id: 'toad',
    });
    taskRepo.transition('TASK-003', { to: 'in_progress' });
    invocationRepo.create({
      id: 'inv-active',
      conversation_id: 'conv-1',
      task_id: 'TASK-003',
      agent_id: 'toad',
    });
    writeTasksMd('todo');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')?.status).toBe('in_progress');
    expect(emit).not.toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'TASK-003',
      previousStatus: 'in_progress',
    }));
    expect(emit).toHaveBeenCalledWith('task.sync', expect.objectContaining({
      conversationId: 'conv-1',
      tasks: [
        expect.objectContaining({
          id: 'TASK-003',
          status: 'in_progress',
        }),
      ],
    }));

    invocationRepo.transition('inv-active', { to: 'terminated', outcome: 'completed' });
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);
    expect(taskRepo.getById('TASK-003')?.status).toBe('in_progress');
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskId: 'TASK-003',
      reasonCode: 'task_state.invalid_projection_transition',
    }));
  });

  it('scopes duplicate TASKS.md IDs without mutating another conversation', () => {
    conversationRepo.create({ id: 'conv-other', title: 'Other Conv' });
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-other',
      title: 'Other project task',
      description: 'must remain unchanged',
      agent_id: 'mario',
    });
    writeTasksMd('todo', 'queued.md');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      conversation_id: 'conv-other',
      title: 'Other project task',
      description: 'must remain unchanged',
      agent_id: 'mario',
      status: 'ready',
    });
    expect(taskRepo.getById('conv-1~TASK-003')).toMatchObject({
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      description: 'queued.md',
      agent_id: 'toad',
      status: 'ready',
    });

    writeTasksMd('doing', 'doing.md');
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);
    writeTasksMd('review', 'review.md');
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);
    writeTasksMd('done', 'done.md');
    syncTasksToDb(projectPath, 'conv-1', io as unknown as IOServer);

    expect(taskRepo.getById('TASK-003')?.status).toBe('ready');
    expect(taskRepo.getById('conv-1~TASK-003')).toMatchObject({
      status: 'in_review',
      description: 'done.md',
    });
  });
});
