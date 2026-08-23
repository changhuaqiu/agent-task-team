import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { AgentInbox, AgentInboxConflictError } from '../platform-events/agent-inbox';
import { CollaborationKernel } from '.';
import type { PlatformEvent } from '../platform-events/types';

describe('CollaborationKernel', () => {
  let db: Database.Database;
  let inbox: AgentInbox;
  let kernel: CollaborationKernel;

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-08-23T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-2','Project 2','active',?,?)
    `).run(now, now);
    inbox = new AgentInbox({ db });
    kernel = new CollaborationKernel({ inbox });
  });

  afterEach(() => db.close());

  it('derives one durable lane and preserves the reply address', () => {
    const receipt = kernel.request({
      projectId: 'project-1',
      targetAgentId: 'builder',
      source: 'workflow',
      requestedAction: 'Implement TASK-1 and submit evidence.',
      idempotencyKey: 'task:TASK-1:revision:2',
      cause: { correlationId: 'delivery-1', causationId: 'task-ready-1' },
      scope: { taskId: 'TASK-1', deliveryRunId: 'delivery-1' },
      replyTo: { type: 'task', id: 'TASK-1' },
    });

    expect(receipt).toMatchObject({
      requestId: 'work-request:project-1:builder:task:TASK-1:revision:2',
      laneId: 'project-1:builder',
      replyTo: { type: 'task', id: 'TASK-1' },
    });
    const [item] = inbox.listPending('project-1');
    expect(item.command).toMatchObject({
      requestId: receipt.requestId,
      laneId: receipt.laneId,
      prompt: 'Implement TASK-1 and submit evidence.',
      replyTo: { type: 'task', id: 'TASK-1' },
      taskId: 'TASK-1',
      deliveryRunId: 'delivery-1',
    });
  });

  it('replays identical requests once and fails closed on conflicting content', () => {
    const request = {
      projectId: 'project-1',
      targetAgentId: 'builder',
      source: 'a2a' as const,
      requestedAction: 'Review the patch.',
      idempotencyKey: 'handoff-1',
      cause: { correlationId: 'chain-1' },
      replyTo: { type: 'a2a_possession' as const, id: 'possession-1' },
    };
    const first = kernel.request(request);
    expect(kernel.request(request)).toEqual(first);
    expect(inbox.listPending('project-1')).toHaveLength(1);

    expect(() => kernel.request({ ...request, requestedAction: 'Implement instead.' }))
      .toThrow(AgentInboxConflictError);
  });

  it('requires an explicit reply address', () => {
    expect(() => kernel.request({
      projectId: 'project-1',
      targetAgentId: 'builder',
      source: 'system',
      requestedAction: 'Recover.',
      idempotencyKey: 'recover-1',
      cause: { correlationId: 'recover-1' },
      replyTo: { type: 'work', id: ' ' },
    })).toThrow('collaboration_reply_to_id_required');
  });

  it('scopes the same caller idempotency key by project and target Agent', () => {
    const base = {
      source: 'system' as const,
      requestedAction: 'Inspect the project.',
      idempotencyKey: 'same-business-key',
      cause: { correlationId: 'same-business-key' },
      replyTo: { type: 'work' as const, id: 'work-1' },
    };

    const first = kernel.request({ ...base, projectId: 'project-1', targetAgentId: 'builder' });
    const second = kernel.request({ ...base, projectId: 'project-2', targetAgentId: 'builder' });
    const third = kernel.request({ ...base, projectId: 'project-1', targetAgentId: 'reviewer' });

    expect(new Set([first.inboxItemId, second.inboxItemId, third.inboxItemId]).size).toBe(3);
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.requestId).not.toBe(third.requestId);
  });

  it('rejects a cause event from another project', () => {
    const causeEvent = {
      projectId: 'project-2',
      eventId: 'event-project-2',
    } as PlatformEvent;
    expect(() => kernel.request({
      projectId: 'project-1',
      targetAgentId: 'builder',
      source: 'workflow',
      requestedAction: 'Do not cross the project boundary.',
      idempotencyKey: 'cross-project-cause',
      cause: { correlationId: 'trace-1', event: causeEvent },
      replyTo: { type: 'work', id: 'work-1' },
    })).toThrow('collaboration_cause_event_project_mismatch');
  });
});
