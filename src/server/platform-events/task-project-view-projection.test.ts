import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from './event-log';
import { taskRepo } from '../repositories/task-repo';
import { TaskProjectViewProjection } from './task-project-view-projection';

describe('TaskProjectViewProjection', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = new Date('2026-08-30T08:00:00.000Z').toISOString();
    db.prepare(`INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)`).run(now, now);
  });

  afterEach(() => resetDb());

  it('publishes the latest task row after a domain transition', () => {
    taskRepo.create({
      id: 'task-1', conversation_id: 'project-1', title: 'Verify', agent_id: 'peach',
    });
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'blocked', reviewNote: 'External blocker' });
    const event = new PlatformEventLog().listStream('task:task-1')
      .find((candidate) => candidate.type === 'task.blocked')!;
    const emit = vi.fn();
    const projection = new TaskProjectViewProjection({
      to: vi.fn(() => ({ emit })),
    } as never);

    projection.handle(event, { signal: new AbortController().signal });

    expect(emit).toHaveBeenCalledWith('project:view', expect.objectContaining({
      type: 'task.state',
      projectId: 'project-1',
      subject: { type: 'task', id: 'task-1' },
      payload: { task: expect.objectContaining({ status: 'blocked', review_note: 'External blocker' }) },
    }));
  });
});
