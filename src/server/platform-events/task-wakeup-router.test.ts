import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { AgentInbox } from './agent-inbox';
import { PlatformEventLog } from './event-log';
import { TaskWakeupRouter } from './task-wakeup-router';

describe('TaskWakeupRouter', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let inbox: AgentInbox;
  let router: TaskWakeupRouter;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-25T05:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({ db });
    inbox = new AgentInbox({ db, eventLog: log });
    router = new TaskWakeupRouter({ inbox });
  });

  afterEach(() => resetDb());

  it('ignores a historical rejection after the task has already completed', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'project-1',
      title: 'Task',
      agent_id: 'implementer',
    });
    taskRepo.updateStatus('task-1', 'rejected', 'Fix it');
    const rejected = log.listStream('task:task-1').find((event) => event.type === 'task.rejected')!;
    taskRepo.updateStatus('task-1', 'done');

    router.handle(rejected, { signal: new AbortController().signal });

    expect(inbox.listQueued('project-1')).toHaveLength(0);
  });

  it('cancels a queued correction when a later terminal fact arrives', () => {
    taskRepo.create({
      id: 'task-2',
      conversation_id: 'project-1',
      title: 'Task',
      agent_id: 'implementer',
    });
    taskRepo.updateStatus('task-2', 'rejected', 'Fix it');
    const rejected = log.listStream('task:task-2').find((event) => event.type === 'task.rejected')!;
    router.handle(rejected, { signal: new AbortController().signal });
    expect(inbox.listQueued('project-1')).toHaveLength(1);

    taskRepo.updateStatus('task-2', 'done');
    const done = log.listStream('task:task-2').find((event) => event.type === 'task.done')!;
    router.handle(done, { signal: new AbortController().signal });

    expect(inbox.listQueued('project-1')).toHaveLength(0);
    expect(db.prepare(
      `SELECT status,last_error FROM agent_inbox_item WHERE project_id='project-1'`,
    ).get()).toEqual({ status: 'cancelled', last_error: 'task_terminal' });
  });
});
