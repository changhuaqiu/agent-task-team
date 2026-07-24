import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db';
import type { HarnessSubmission } from '../harness/types';
import { AgentInbox } from './agent-inbox';
import { AgentInboxScheduler } from './agent-inbox-scheduler';
import { PlatformEventLog } from './event-log';

describe('AgentInboxScheduler', () => {
  let db: Database.Database;
  let inbox: AgentInbox;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-25T02:00:00.000Z'));
    db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    inbox = new AgentInbox({
      db,
      eventLog: new PlatformEventLog({ db }),
    });
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it('releases busy work and later consumes it through Harness', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'turn-1',
      command: { source: 'user', prompt: 'Implement' },
    });
    let submissions = 0;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 10,
      retryDelayMs: 10,
      submit: () => {
        submissions += 1;
        if (submissions === 1) {
          return {
            disposition: 'deferred',
            handled: false,
            completion: Promise.resolve({ status: 'deferred', reasonCode: 'agent_busy' }),
          } satisfies HarnessSubmission;
        }
        return {
          disposition: 'accepted',
          handled: true,
          completion: Promise.resolve({ status: 'accepted' }),
        } satisfies HarnessSubmission;
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)).toMatchObject({ status: 'queued', attemptCount: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(inbox.get(item.id)).toMatchObject({ status: 'completed', attemptCount: 2 });
    expect(submissions).toBe(2);
    scheduler.stop();
  });

  it('settles different agents concurrently and heartbeats accepted work', async () => {
    const first = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'concurrent-1',
      command: { source: 'user', prompt: 'One' },
    });
    const second = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'concurrent-2',
      command: { source: 'user', prompt: 'Two' },
    });
    const resolvers: Array<(outcome: { status: 'accepted' }) => void> = [];
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 100,
      leaseMs: 10,
      heartbeatMs: 3,
      submit: () => ({
        disposition: 'accepted',
        handled: true,
        completion: new Promise((resolve) => resolvers.push(resolve)),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvers).toHaveLength(2);
    expect(inbox.get(first.id)?.status).toBe('claimed');
    expect(inbox.get(second.id)?.status).toBe('claimed');
    await vi.advanceTimersByTimeAsync(25);
    expect(inbox.recoverExpired()).toBe(0);
    resolvers.forEach((resolve) => resolve({ status: 'accepted' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(inbox.get(first.id)?.status).toBe('completed');
    expect(inbox.get(second.id)?.status).toBe('completed');
    scheduler.stop();
  });

  it('stops settlement heartbeats so another scheduler can recover the lease', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'shutdown-recovery',
      command: { source: 'system', prompt: 'Recover after shutdown' },
    });
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 100,
      leaseMs: 10,
      heartbeatMs: 3,
      submit: () => ({
        disposition: 'accepted',
        handled: true,
        completion: new Promise(() => {}),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)?.status).toBe('claimed');
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(11);
    expect(inbox.recoverExpired()).toBe(1);
  });

  it('settles an in-flight Harness duplicate instead of completing it eagerly', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'in-flight-duplicate',
      command: { source: 'system', prompt: 'Reuse execution' },
    });
    let resolveOutcome!: (outcome: { status: 'failed'; reasonCode: 'internal_error' }) => void;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 100,
      submit: () => ({
        disposition: 'duplicate',
        duplicateInFlight: true,
        handled: true,
        completion: new Promise((resolve) => {
          resolveOutcome = resolve;
        }),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)?.status).toBe('claimed');
    resolveOutcome({ status: 'failed', reasonCode: 'internal_error' });
    await Promise.resolve();
    await Promise.resolve();
    expect(inbox.get(item.id)?.status).toBe('failed');
    scheduler.stop();
  });
});
