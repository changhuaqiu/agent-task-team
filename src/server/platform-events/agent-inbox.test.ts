import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { AgentInbox, AgentInboxCapacityError, AgentInboxConflictError } from './agent-inbox';
import { PlatformEventLog } from './event-log';

describe('AgentInbox', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let inbox: AgentInbox;
  let now: Date;
  let id = 0;

  beforeEach(() => {
    db = createTestDb();
    now = new Date('2026-07-25T01:00:00.000Z');
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    log = new PlatformEventLog({
      db,
      now: () => now,
      idFactory: () => `pev-${++id}`,
    });
    inbox = new AgentInbox({
      db,
      eventLog: log,
      now: () => now,
      idFactory: (prefix) => `${prefix}-${++id}`,
    });
  });

  afterEach(() => db.close());

  it('enqueues idempotently and emits coordination in the same transaction', () => {
    const input = {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'user-turn-1',
      command: { source: 'user' as const, prompt: 'Implement it' },
    };
    const first = inbox.enqueue(input);
    expect(inbox.enqueue(input)).toEqual(first);
    expect(log.listStream('agent-work:project-1:implementer').map((event) => event.type))
      .toEqual(['agent.work.enqueued']);
    expect(() => inbox.enqueue({
      ...input,
      command: { source: 'user', prompt: 'Different' },
    })).toThrow(AgentInboxConflictError);
  });

  it('claims one item per project agent and preserves FIFO order', () => {
    const first = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'one',
      command: { source: 'user', prompt: 'One' },
    });
    now = new Date(now.getTime() + 1);
    const second = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'two',
      command: { source: 'user', prompt: 'Two' },
    });
    const claim = inbox.claimNext()!;
    expect(claim.id).toBe(first.id);
    expect(claim.status).toBe('claimed');
    expect(inbox.claimNext()).toBeUndefined();
    expect(inbox.admit(claim.id, claim.leaseToken!)).toBe(true);
    expect(inbox.get(first.id)).toMatchObject({
      status: 'admitted',
      settledAt: now.toISOString(),
    });
    expect(inbox.claimNext()!.id).toBe(second.id);
  });

  it('bounds one durable runtime lane without breaking idempotent replay', () => {
    inbox = new AgentInbox({
      db,
      eventLog: log,
      now: () => now,
      idFactory: (prefix) => `${prefix}-${++id}`,
      maxPendingPerRuntimeLane: 2,
    });
    const first = {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'bounded-one',
      command: { source: 'user' as const, prompt: 'One' },
    };
    inbox.enqueue(first);
    inbox.enqueue({ ...first, idempotencyKey: 'bounded-two', command: { source: 'user', prompt: 'Two' } });

    expect(inbox.enqueue(first).idempotencyKey).toBe('bounded-one');
    expect(() => inbox.enqueue({
      ...first,
      idempotencyKey: 'bounded-three',
      command: { source: 'user', prompt: 'Three' },
    })).toThrow(AgentInboxCapacityError);
  });

  it('does not claim the next lane item while another Runtime owner lease is live', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'cross-daemon-lane',
      command: { source: 'system', prompt: 'Wait for the other daemon' },
    });
    const leaseExpiry = new Date(now.getTime() + 30_000).toISOString();
    db.prepare(`INSERT INTO invocation
      (id,conversation_id,agent_id,status,lease_expiry,runtime_owner_id,runtime_owner_token,
       revision,created_at,updated_at)
      VALUES ('inv-live','project-1','implementer','running',?,'daemon-1','owner-1',0,?,?)`)
      .run(leaseExpiry, now.toISOString(), now.toISOString());

    expect(inbox.claimNext()).toBeUndefined();
    now = new Date(now.getTime() + 30_001);
    expect(inbox.claimNext()?.id).toBe(item.id);
  });

  it('commits claim admission and Envelope acknowledgement as one fenced transaction', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'atomic-runtime-ack',
      command: { source: 'system', prompt: 'Commit atomically', taskId: 'TASK-1' },
    });
    const claim = inbox.claimNext()!;
    db.prepare(`INSERT INTO invocation
      (id,conversation_id,agent_id,status,lease_expiry,runtime_owner_id,runtime_owner_token,
       revision,created_at,updated_at)
      VALUES ('inv-1','project-1','implementer','starting',?,'daemon-1',?,0,?,?)`)
      .run(
        new Date(now.getTime() + 30_000).toISOString(),
        claim.leaseToken,
        now.toISOString(),
        now.toISOString(),
      );
    db.exec('CREATE TABLE runtime_ack_probe (acknowledged INTEGER NOT NULL)');
    db.prepare('INSERT INTO runtime_ack_probe (acknowledged) VALUES (0)').run();

    const admission = { invocationId: 'inv-1', traceId: 'trace-1' };
    const committed = inbox.admitWithClaimFence(item.id, claim.leaseToken!, () => {
      db.prepare('UPDATE runtime_ack_probe SET acknowledged=1').run();
      db.prepare(`UPDATE agent_inbox_item
        SET status='cancelled',lease_token=NULL,lease_expires_at=NULL,
          settled_at=?,updated_at=? WHERE id=?`).run(
        now.toISOString(),
        now.toISOString(),
        item.id,
      );
      return true;
    }, admission);

    expect(committed).toBe(false);
    expect(db.prepare('SELECT acknowledged FROM runtime_ack_probe').get())
      .toEqual({ acknowledged: 0 });
    expect(inbox.get(item.id)).toMatchObject({
      status: 'claimed',
      leaseToken: claim.leaseToken,
    });

    expect(inbox.admitWithClaimFence(item.id, claim.leaseToken!, () => {
      db.prepare('UPDATE runtime_ack_probe SET acknowledged=1').run();
      return true;
    }, admission)).toBe(true);
    expect(db.prepare('SELECT acknowledged FROM runtime_ack_probe').get())
      .toEqual({ acknowledged: 1 });
    expect(inbox.get(item.id)?.status).toBe('admitted');
    expect(log.listStream('agent-work:project-1:implementer').at(-1)?.payload)
      .toMatchObject({ runtimeAdmission: admission });
  });

  it('carries source correlation and causation into the durable work command', () => {
    const source = log.append({
      type: 'task.assigned',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:task-1',
      aggregate: { type: 'task', id: 'task-1' },
      actor: { type: 'system', id: 'task-owner' },
      correlationId: 'goal-trace-1',
      payload: { agentId: 'implementer', status: 'ready' },
    });

    const queued = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'task-1',
      sourceEvent: source,
      command: { source: 'system', prompt: 'Implement task-1' },
    });
    expect(queued.command).toMatchObject({
      correlationId: 'goal-trace-1',
      causationId: source.eventId,
    });
    const claimed = inbox.claimNext()!;
    expect(inbox.admit(claimed.id, claimed.leaseToken!)).toBe(true);
    expect(log.listTrace('goal-trace-1').map((event) => event.type)).toEqual([
      'task.assigned',
      'agent.work.enqueued',
      'agent.work.claimed',
      'agent.work.admitted',
    ]);
  });

  it('preserves command causation even when no source event row is supplied', () => {
    const queued = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'command-trace-1',
      command: {
        source: 'system',
        prompt: 'Implement',
        correlationId: 'goal-trace-command',
        causationId: 'decision-event-1',
      },
    });
    const claimed = inbox.claimNext()!;
    expect(inbox.admit(queued.id, claimed.leaseToken!)).toBe(true);
    expect(log.listTrace('goal-trace-command')).toMatchObject([
      { type: 'agent.work.enqueued', causationId: 'decision-event-1' },
      { type: 'agent.work.claimed', causationId: 'decision-event-1' },
      { type: 'agent.work.admitted', causationId: 'decision-event-1' },
    ]);
  });

  it('does not let later work overtake a released FIFO predecessor', () => {
    const first = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'fifo-one',
      command: { source: 'user', prompt: 'One' },
    });
    now = new Date(now.getTime() + 1);
    inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'fifo-two',
      command: { source: 'user', prompt: 'Two' },
    });
    const claim = inbox.claimNext()!;
    expect(claim.id).toBe(first.id);
    inbox.release(claim.id, claim.leaseToken!, 100, 'agent_busy');

    expect(inbox.claimNext()).toBeUndefined();
    now = new Date(now.getTime() + 100);
    expect(inbox.claimNext()!.id).toBe(first.id);
  });

  it('recovers an expired lease and fences stale completion', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'review-1',
      command: { source: 'review_gate', prompt: 'Review' },
    });
    const claim = inbox.claimNext(10)!;
    now = new Date(now.getTime() + 11);
    expect(inbox.releaseExpiredClaims()).toBe(1);
    expect(inbox.admit(item.id, claim.leaseToken!)).toBe(false);
    const replacement = inbox.claimNext()!;
    expect(replacement.attemptCount).toBe(2);
    expect(log.listStream('agent-work:project-1:reviewer').map((event) => event.type))
      .toEqual([
        'agent.work.enqueued',
        'agent.work.claimed',
        'agent.work.released',
        'agent.work.claimed',
      ]);
  });

  it('renews only the active fenced lease', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'review-heartbeat',
      command: { source: 'review_gate', prompt: 'Review' },
    });
    const claim = inbox.claimNext(10)!;
    now = new Date(now.getTime() + 5);

    expect(inbox.renew(item.id, 'stale-token', 20)).toBe(false);
    expect(inbox.renew(item.id, claim.leaseToken!, 20)).toBe(true);
    now = new Date(now.getTime() + 6);
    expect(inbox.releaseExpiredClaims()).toBe(0);
    now = new Date(now.getTime() + 15);
    expect(inbox.releaseExpiredClaims()).toBe(1);
  });

  it('fences every stale lease operation before the recovery sweep runs', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'review-stale-before-sweep',
      command: { source: 'review_gate', prompt: 'Review' },
    });
    const claim = inbox.claimNext(10)!;
    now = new Date(now.getTime() + 11);

    expect(inbox.renew(item.id, claim.leaseToken!, 20)).toBe(false);
    expect(inbox.release(item.id, claim.leaseToken!, 0, 'late_worker')).toBe(false);
    expect(inbox.admit(item.id, claim.leaseToken!)).toBe(false);
    expect(inbox.expire(item.id, claim.leaseToken!, 'late_worker')).toBe(false);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'claimed',
      leaseToken: claim.leaseToken,
    });
    expect(inbox.releaseExpiredClaims()).toBe(1);
  });

  it('expires a rejected claim without pretending that Agent execution failed', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'preflight-rejected',
      command: { source: 'review_gate', prompt: 'Review' },
    });
    const claim = inbox.claimNext()!;

    expect(inbox.expire(item.id, claim.leaseToken!, 'runtime_profile_missing')).toBe(true);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'expired',
      lastError: 'runtime_profile_missing',
      settledAt: now.toISOString(),
    });
    expect(inbox.claimNext()).toBeUndefined();
    expect(log.listStream('agent-work:project-1:reviewer').map((event) => event.type))
      .toEqual([
        'agent.work.enqueued',
        'agent.work.claimed',
        'agent.work.expired',
      ]);
  });

  it('keeps expired work visible and supports an explicit manual retry', () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'reviewer',
      idempotencyKey: 'retry-visible-failure',
      command: { source: 'review_gate', prompt: 'Review', taskId: 'TASK-RETRY' },
    });
    const claim = inbox.claimNext()!;
    expect(inbox.expire(item.id, claim.leaseToken!, 'runtime_start_failed', true)).toBe(true);

    expect(inbox.listExpired('project-1')).toEqual([
      expect.objectContaining({
        id: item.id,
        status: 'expired',
        lastError: 'runtime_start_failed',
        runtimeStartFailureCount: 1,
      }),
    ]);
    expect(inbox.retryExpired(item.id)).toMatchObject({
      status: 'released',
      attemptCount: 0,
      runtimeStartFailureCount: 0,
    });
    expect(inbox.listExpired('project-1')).toEqual([]);
    expect(inbox.claimNext()?.id).toBe(item.id);
    expect(log.listStream('agent-work:project-1:reviewer').map((event) => event.type))
      .toEqual([
        'agent.work.enqueued',
        'agent.work.claimed',
        'agent.work.expired',
        'agent.work.released',
        'agent.work.claimed',
      ]);
  });

  it('expires an repeatedly abandoned lease so the next lane item can proceed after manual action', () => {
    const first = inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'reviewer', idempotencyKey: 'lease-head',
      command: { source: 'review_gate', prompt: 'Head' },
    });
    inbox.enqueue({
      projectId: 'project-1', projectAgentId: 'reviewer', idempotencyKey: 'lease-next',
      command: { source: 'review_gate', prompt: 'Next' },
    });
    inbox.claimNext(10);
    now = new Date(now.getTime() + 11);
    expect(inbox.releaseExpiredClaims(1)).toBe(1);
    expect(inbox.get(first.id)).toMatchObject({ status: 'expired', lastError: 'lease_expired_retry_exhausted' });
    expect(inbox.claimNext()?.idempotencyKey).toBe('lease-next');
  });

  it('cancels queued work without cancelling an active claim', () => {
    const active = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'active',
      command: { source: 'user', prompt: 'Active' },
    });
    inbox.claimNext();
    inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'queued',
      command: { source: 'user', prompt: 'Queued' },
    });

    expect(inbox.cancelPending('project-1', 'implementer')).toBe(1);
    expect(inbox.get(active.id)?.status).toBe('claimed');
    expect(inbox.listPending('project-1')).toEqual([
      expect.objectContaining({ id: active.id, status: 'claimed' }),
    ]);
  });
});
