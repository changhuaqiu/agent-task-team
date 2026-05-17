import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { syncTasksToDb } from '@/server/task-file-watcher';

let projectPath: string;

beforeEach(() => {
  setTestDb(createTestDb());
  resetSeq();
  conversationRepo.create({ id: 'conv-1', title: 'Watcher Conv' });
  projectPath = join(tmpdir(), `ath-task-watcher-${Date.now()}-${Math.random().toString(36).slice(2)}`, 'conv-1');
  mkdirSync(join(projectPath, '.ath'), { recursive: true });
});

afterEach(() => {
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
});
