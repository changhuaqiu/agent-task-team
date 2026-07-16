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
import { startTaskWatcher, stopTaskWatcher, syncTasksToDb } from '@/server/task-file-watcher';

let projectPath: string;

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'conv-1', title: 'Watcher Conv' });
  projectPath = join(tmpdir(), `ath-task-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'conv-1');
  mkdirSync(join(projectPath, '.ath'), { recursive: true });
});

afterEach(() => {
  stopTaskWatcher(projectPath);
  rmSync(projectPath, { recursive: true, force: true });
  resetDb();
  resetSeq();
});

function writeTasksMd(status: string, deliverable = '-'): void {
  writeFileSync(join(projectPath, '.ath', 'TASKS.md'), `# 任务看板

| ID | Title | Phase | Role | Agent | Status | Depends | Deliverable |
|----|-------|-------|------|-------|--------|---------|-------------|
| TASK-003 | 修复 A2A 通知 | P1 | backend | toad | ${status} | - | ${deliverable} |
`, 'utf-8');
}

describe('syncTasksToDb', () => {
  it('projects TASKS.md when the watched file is created for the first time', async () => {
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    startTaskWatcher(projectPath, io as any);
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

  it('reprojects an existing TASKS.md when the watcher starts after a restart', async () => {
    upsertAgent({
      id: 'peach',
      name: 'Peach',
      roleCardId: 'preset-code-reviewer',
      theme: 'peach',
      emoji: '🌸',
    });
    writeTasksMd('review', 'review.md');
    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    startTaskWatcher(projectPath, io as any);

    const deadline = Date.now() + 5_000;
    while (!taskRepo.getById('TASK-003') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      status: 'in_review',
      description: 'review.md',
    });
    expect(emit).toHaveBeenCalledWith('task.wakeup', expect.objectContaining({
      agentId: 'peach',
      reasonCode: 'review_requested',
      taskId: 'TASK-003',
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
    taskRepo.updateStatus('TASK-003', 'in_progress');
    writeTasksMd('review', 'src/server/task-flow/task-notifications.ts');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };

    syncTasksToDb(projectPath, io as any);

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

  it('does not let a stale todo file regress a task with an active invocation', () => {
    taskRepo.create({
      id: 'TASK-003',
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      agent_id: 'toad',
    });
    taskRepo.updateStatus('TASK-003', 'in_progress');
    invocationRepo.create({
      id: 'inv-active',
      conversation_id: 'conv-1',
      task_id: 'TASK-003',
      agent_id: 'toad',
    });
    writeTasksMd('todo');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, io as any);

    expect(taskRepo.getById('TASK-003')?.status).toBe('in_progress');
    expect(emit).not.toHaveBeenCalledWith('task.notification', expect.objectContaining({
      taskId: 'TASK-003',
      previousStatus: 'in_progress',
    }));

    invocationRepo.updateStatus('inv-active', 'succeeded');
    syncTasksToDb(projectPath, io as any);
    expect(taskRepo.getById('TASK-003')?.status).toBe('pending');
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
    writeTasksMd('review', 'review.md');

    const emit = vi.fn();
    const io = { to: vi.fn(() => ({ emit })), emit: vi.fn() };
    syncTasksToDb(projectPath, io as any);

    expect(taskRepo.getById('TASK-003')).toMatchObject({
      conversation_id: 'conv-other',
      title: 'Other project task',
      description: 'must remain unchanged',
      agent_id: 'mario',
      status: 'pending',
    });
    expect(taskRepo.getById('conv-1~TASK-003')).toMatchObject({
      conversation_id: 'conv-1',
      title: '修复 A2A 通知',
      description: 'review.md',
      agent_id: 'toad',
      status: 'in_review',
    });

    writeTasksMd('done', 'done.md');
    syncTasksToDb(projectPath, io as any);

    expect(taskRepo.getById('TASK-003')?.status).toBe('pending');
    expect(taskRepo.getById('conv-1~TASK-003')).toMatchObject({
      status: 'done',
      description: 'done.md',
    });
  });
});
