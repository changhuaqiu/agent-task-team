import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { AgentInbox } from './agent-inbox';
import { AgentInboxRouter } from './agent-inbox-router';
import { PlatformEventLog } from './event-log';

describe('AgentInboxRouter', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let inbox: AgentInbox;

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-07-25T01:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({ db });
    inbox = new AgentInbox({ db, eventLog: log });
  });

  afterEach(() => db.close());

  it('maps a domain event to an idempotent Inbox command without starting runtime work', () => {
    const event = log.append({
      type: 'task.assigned',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1', version: 1 },
      actor: { type: 'user', id: 'user-1' },
      correlationId: 'task-1',
      payload: { assigneeId: 'implementer' },
    });
    let resolutions = 0;
    const router = new AgentInboxRouter({
      inbox,
      resolve: (candidate) => {
        resolutions += 1;
        return {
          projectAgentId: String((candidate.payload as { assigneeId: string }).assigneeId),
          command: { source: 'workflow', prompt: 'Task task-1 was assigned', taskId: 'task-1' },
        };
      },
    });
    const signal = new AbortController().signal;

    router.handle(event, { signal });
    router.handle(event, { signal });

    expect(resolutions).toBe(2);
    expect(inbox.listPending('project-1')).toEqual([
      expect.objectContaining({
        projectAgentId: 'implementer',
        sourceEventId: event.eventId,
        command: expect.objectContaining({ taskId: 'task-1' }),
      }),
    ]);
    expect(log.listStream('agent-work:project-1:implementer').map((item) => item.type))
      .toEqual(['agent.work.enqueued']);
  });

  it('ignores non-domain events', () => {
    const event = log.append({
      type: 'agent.work.released',
      category: 'coordination',
      projectId: 'project-1',
      streamKey: 'agent-work:project-1:implementer',
      aggregate: { type: 'agent_inbox_item', id: 'inbox-1' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'inbox-1',
      payload: {},
    });
    const router = new AgentInboxRouter({
      inbox,
      resolve: () => ({
        projectAgentId: 'implementer',
        command: { source: 'system', prompt: 'Should not run' },
      }),
    });

    router.handle(event, { signal: new AbortController().signal });

    expect(inbox.listPending()).toHaveLength(0);
  });
});
