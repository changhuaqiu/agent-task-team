import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import {
  PlatformEventDedupeConflictError,
  PlatformEventLog,
} from './event-log';

function insertProject(db: Database.Database, id = 'project-1'): void {
  const now = '2026-07-24T00:00:00.000Z';
  db.prepare(`
    INSERT INTO conversation (id,title,status,created_at,updated_at)
    VALUES (?,?,'active',?,?)
  `).run(id, id, now, now);
}

describe('PlatformEventLog', () => {
  let db: Database.Database;
  let id = 0;
  let log: PlatformEventLog;

  beforeEach(() => {
    db = createTestDb();
    insertProject(db);
    log = new PlatformEventLog({
      db,
      now: () => new Date('2026-07-24T00:00:00.000Z'),
      idFactory: () => `pev-${++id}`,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('assigns local sequence numbers independently for each stream', () => {
    const first = log.append({
      type: 'task.created',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1', version: 1 },
      actor: { type: 'agent', id: 'planner' },
      correlationId: 'goal-1',
      payload: { title: 'Implement events' },
    });
    const second = log.append({
      type: 'task.assigned',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1', version: 2 },
      actor: { type: 'system', id: 'task-module' },
      subject: { type: 'project_agent', id: 'implementer' },
      projectAgentId: 'implementer',
      correlationId: 'goal-1',
      causationId: first.eventId,
      payload: { assigneeId: 'implementer' },
    });
    const otherStream = log.append({
      type: 'task.created',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-2',
      aggregate: { type: 'task', id: 'task-2', version: 1 },
      actor: { type: 'agent', id: 'planner' },
      correlationId: 'goal-1',
      payload: { title: 'Document events' },
    });

    expect([first.streamSequence, second.streamSequence]).toEqual([1, 2]);
    expect(otherStream.streamSequence).toBe(1);
    expect(log.listStream('task:task-1').map((event) => event.eventId))
      .toEqual([first.eventId, second.eventId]);
    expect(log.listTrace('goal-1').map((event) => event.eventId))
      .toEqual([first.eventId, second.eventId, otherStream.eventId]);
  });

  it('returns the existing event for an identical dedupe retry', () => {
    const input = {
      type: 'agent.work.enqueued' as const,
      category: 'coordination' as const,
      projectId: 'project-1',
      streamKey: 'agent-work:project-1:implementer',
      aggregate: { type: 'agent_inbox', id: 'implementer' },
      actor: { type: 'system' as const, id: 'wakeup-router' },
      projectAgentId: 'implementer',
      inboxItemId: 'inbox-1',
      correlationId: 'goal-1',
      dedupeKey: 'task-1:implementer:task_owner',
      payload: { sourceEventId: 'task-assigned-1', priority: 10 },
    };

    const first = log.append(input);
    const retried = log.append({
      ...input,
      payload: { priority: 10, sourceEventId: 'task-assigned-1' },
    });

    expect(retried).toEqual(first);
    expect(log.listStream(input.streamKey)).toHaveLength(1);
  });

  it('rejects a dedupe key reused for different content', () => {
    const base = {
      type: 'agent.work.enqueued' as const,
      category: 'coordination' as const,
      projectId: 'project-1',
      streamKey: 'agent-work:project-1:implementer',
      aggregate: { type: 'agent_inbox', id: 'implementer' },
      actor: { type: 'system' as const, id: 'wakeup-router' },
      projectAgentId: 'implementer',
      correlationId: 'goal-1',
      dedupeKey: 'task-1:implementer:task_owner',
    };
    log.append({ ...base, payload: { sourceEventId: 'event-1' } });

    expect(() => log.append({
      ...base,
      payload: { sourceEventId: 'event-2' },
    })).toThrow(PlatformEventDedupeConflictError);
  });

  it('treats a different explicit occurrence timestamp as a dedupe conflict', () => {
    const input = {
      type: 'task.created' as const,
      category: 'domain' as const,
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1' },
      actor: { type: 'agent' as const, id: 'planner' },
      correlationId: 'goal-1',
      dedupeKey: 'task-created:task-1',
      occurredAt: '2026-07-24T00:00:01.000Z',
      payload: { title: 'Implement events' },
    };
    log.append(input);

    expect(() => log.append({
      ...input,
      occurredAt: '2026-07-24T00:00:02.000Z',
    })).toThrow(PlatformEventDedupeConflictError);
  });

  it('queries events by invocation and ProjectAgent', () => {
    const event = log.append({
      type: 'runtime.invocation.accepted',
      category: 'runtime_lifecycle',
      projectId: 'project-1',
      streamKey: 'invocation:inv-1',
      aggregate: { type: 'invocation', id: 'inv-1' },
      actor: { type: 'runtime', id: 'local-daemon' },
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      correlationId: 'goal-1',
      payload: { envelopeId: 'env-1' },
    });

    expect(log.listByInvocation('inv-1')).toEqual([event]);
    expect(log.listByProjectAgent('project-1', 'implementer')).toEqual([event]);
  });
});
