import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { readTasksMd } from '@/server/task-file-service';
import {
  resolveTaskStorageIds,
  startTaskWatcher,
  stopTaskWatcher,
  syncTasksToDb,
} from '@/server/task-file-watcher';
import type { Server as IOServer } from 'socket.io';

let projectPath: string;

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'conv-1', title: 'Watcher Conv' });
  projectPath = join(tmpdir(), `ath-task-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'runtime-dir');
  mkdirSync(join(projectPath, '.ath'), { recursive: true });
});

afterEach(() => {
  stopTaskWatcher(projectPath, 'conv-1');
  stopTaskWatcher(projectPath, 'conv-other');
  rmSync(projectPath, { recursive: true, force: true });
  resetDb();
  resetSeq();
});

function writeTasksMd(status: string, deliverable = '-', overrides?: { title?: string; agent?: string }): void {
  writeFileSync(join(projectPath, '.ath', 'TASKS.md'), `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-003 | ${overrides?.title ?? 'File task'} | P1 | backend | ${overrides?.agent ?? 'toad'} | ${status} | - | ${deliverable} |
`, 'utf-8');
}

function ioDouble() {
  const emit = vi.fn();
  return { emit, io: { to: vi.fn(() => ({ emit })), emit: vi.fn() } as unknown as IOServer };
}

describe('syncTasksToDb', () => {
  it('reconciles the first created TASKS.md from Task Graph without importing file state', async () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Authoritative task',
      description: 'authoritative.md',
      agent_id: 'peach',
    });
    taskRepo.updateStatus('TASK-003', 'in_review');
    const { io } = ioDouble();

    startTaskWatcher(projectPath, 'conv-1', io);
    await new Promise(resolve => setTimeout(resolve, 100));
    writeTasksMd('doing', 'stale.md');

    const deadline = Date.now() + 5_000;
    while (readTasksMd(projectPath).tasks[0]?.status !== 'in_review' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'in_review',
      agent_id: 'peach',
      description: 'authoritative.md',
    });
    expect(readTasksMd(projectPath).tasks[0]).toMatchObject({
      title: 'Authoritative task',
      status: 'in_review',
      agent: 'peach',
      deliverable: 'authoritative.md',
    });
  });

  it('reprojects an existing stale TASKS.md when the watcher starts after a restart', async () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Persisted task',
      description: 'persisted.md',
      agent_id: 'peach',
    });
    taskRepo.updateStatus('TASK-003', 'done', 'PASS: persisted review');
    writeTasksMd('doing', 'stale.md');
    const { io } = ioDouble();

    startTaskWatcher(projectPath, 'conv-1', io);

    const deadline = Date.now() + 5_000;
    while (readTasksMd(projectPath).tasks[0]?.status !== 'done' && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'done',
      review_note: 'PASS: persisted review',
    });
    expect(readTasksMd(projectPath).tasks[0]).toMatchObject({ status: 'done', deliverable: 'persisted.md' });
  });

  it('does not let TASKS.md mutate any existing Task Graph field', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Authoritative title',
      description: 'authoritative.md',
      agent_id: 'peach',
      dependencies: ['TASK-002'],
    });
    taskRepo.updateStatus('TASK-003', 'in_progress');
    writeTasksMd('review', 'stale.md', { title: 'Forged title', agent: 'toad' });
    const { emit, io } = ioDouble();

    syncTasksToDb(projectPath, 'conv-1', io);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      title: 'Authoritative title',
      description: 'authoritative.md',
      status: 'in_progress',
      agent_id: 'peach',
      dependencies: '["TASK-002"]',
    });
    expect(emit).not.toHaveBeenCalledWith('task.notification', expect.anything());
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      reasonCode: 'task_graph.file_projection_read_only',
      taskIds: ['TASK-003'],
    }));
  });

  it('keeps storage identity conversation-scoped when local IDs collide', () => {
    conversationRepo.create({ id: 'conv-other', title: 'Other conversation' });
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-other',
      title: 'Other task',
      agent_id: 'mario',
    });

    expect(resolveTaskStorageIds('conv-1', ['TASK-003']).get('TASK-003')).toBe('conv-1~TASK-003');
    expect(resolveTaskStorageIds('conv-other', ['TASK-003']).get('TASK-003')).toBe('TASK-003');
  });

  it('does not let a stale file roll an accepted review state backward', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Keep review state',
      agent_id: 'toad',
    });
    taskRepo.updateStatus('TASK-003', 'in_review');
    writeTasksMd('doing', 'stale runtime projection');
    const { emit, io } = ioDouble();

    syncTasksToDb(projectPath, 'conv-1', io);

    expect(taskRepo.getById('TASK-003')?.status).toBe('in_review');
    expect(readTasksMd(projectPath).tasks[0].status).toBe('in_review');
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      taskIds: ['TASK-003'],
      reasonCode: 'task_graph.file_projection_read_only',
    }));
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.file_projection.reconciled',
      conversationId: 'conv-1',
      taskId: 'TASK-003',
      reasonCode: 'task_graph.file_projection_read_only',
    })).toHaveLength(1);
  });

  it('never restores file authority after an invocation boundary', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: 'Read-only projection',
      agent_id: 'toad',
    });
    taskRepo.updateStatus('TASK-003', 'in_progress');
    const { io } = ioDouble();

    writeTasksMd('todo');
    syncTasksToDb(projectPath, 'conv-1', io);
    writeTasksMd('todo');
    syncTasksToDb(projectPath, 'conv-1', io);

    expect(taskRepo.getById('TASK-003')?.status).toBe('in_progress');
    expect(readTasksMd(projectPath).tasks[0].status).toBe('in_progress');
  });

  it('scopes duplicate file IDs without mutating another conversation', () => {
    conversationRepo.create({ id: 'conv-other', title: 'Other Conv' });
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-other',
      title: 'Other project task',
      description: 'must remain unchanged',
      agent_id: 'mario',
    });
    taskRepo.create({
      id: 'conv-1~TASK-003',
      conversation_id: 'conv-1',
      title: 'Scoped authoritative task',
      description: 'authoritative.md',
      agent_id: 'peach',
    });
    taskRepo.updateStatus('conv-1~TASK-003', 'in_review');
    writeTasksMd('done', 'forged.md');
    const { io } = ioDouble();

    syncTasksToDb(projectPath, 'conv-1', io);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      conversation_id: 'conv-other',
      status: 'pending',
      description: 'must remain unchanged',
    });
    expect(taskRepo.getById('conv-1~TASK-003')).toMatchObject({
      conversation_id: 'conv-1',
      status: 'in_review',
      description: 'authoritative.md',
    });
    expect(readTasksMd(projectPath).tasks[0]).toMatchObject({
      id: 'TASK-003',
      status: 'in_review',
      deliverable: 'authoritative.md',
    });
  });

  it('ignores unknown file-only tasks instead of creating Task Graph facts', () => {
    writeTasksMd('done', 'forged.md');
    const { emit, io } = ioDouble();

    syncTasksToDb(projectPath, 'conv-1', io);

    expect(taskRepo.getByConversation('conv-1')).toHaveLength(0);
    expect(readTasksMd(projectPath).tasks).toHaveLength(0);
    expect(emit).toHaveBeenCalledWith('task.sync_error', expect.objectContaining({
      reasonCode: 'task_graph.file_projection_read_only',
      taskIds: ['TASK-003'],
    }));
  });
});
