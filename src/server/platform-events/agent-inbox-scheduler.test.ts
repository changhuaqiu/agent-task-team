import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db';
import type { InvocationSubmission } from '../invocation-pipeline/types';
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

  it('releases busy work and later consumes it through the Invocation Pipeline', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'turn-1',
      command: {
        source: 'user',
        prompt: 'Implement',
        correlationId: 'goal-trace-1',
        causationId: 'message-1',
        possessionId: 'possession-1',
        possessionRevision: 4,
        executionMode: 'outcome_recovery',
        a2aHandoff: {
          title: 'lead',
          requestedAction: 'Implement',
          possessionSummary: 'Implement the feature',
          relevantDecisions: [],
          evidenceRefs: ['spec.md'],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: [],
        },
        wakeup: {
          reasonCode: 'missing_implementation_evidence',
          reasonSummary: 'Evidence is incomplete',
        },
        legacyProposal: true,
      },
    });
    let submissions = 0;
    let submittedTrace: {
      correlationId?: string;
      causationId?: string;
      possessionId?: string;
      possessionRevision?: number;
      executionMode?: string;
      a2aHandoff?: { evidenceRefs: string[] };
      wakeup?: { reasonCode: string; reasonSummary?: string };
      legacyProposal?: boolean;
    } | undefined;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 10,
      retryDelayMs: 10,
      submit: (trigger) => {
        submittedTrace = trigger;
        submissions += 1;
        if (submissions === 1) {
          return {
            disposition: 'deferred',
            handled: false,
            started: Promise.resolve({ status: 'deferred', reasonCode: 'agent_busy' }),
            completion: Promise.resolve({ status: 'deferred', reasonCode: 'agent_busy' }),
          } satisfies InvocationSubmission;
        }
        return {
          disposition: 'accepted',
          handled: true,
          started: Promise.resolve({ status: 'accepted' }),
          completion: Promise.resolve({ status: 'accepted' }),
        } satisfies InvocationSubmission;
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)).toMatchObject({ status: 'released', attemptCount: 1 });
    await vi.advanceTimersByTimeAsync(10);
    expect(inbox.get(item.id)).toMatchObject({ status: 'admitted', attemptCount: 2 });
    expect(submissions).toBe(2);
    expect(submittedTrace).toMatchObject({
      correlationId: 'goal-trace-1',
      causationId: 'message-1',
      possessionId: 'possession-1',
      possessionRevision: 4,
      executionMode: 'outcome_recovery',
      a2aHandoff: expect.objectContaining({ evidenceRefs: ['spec.md'] }),
      wakeup: {
        reasonCode: 'missing_implementation_evidence',
        reasonSummary: 'Evidence is incomplete',
      },
      legacyProposal: true,
    });
    scheduler.stop();
  });

  it('admits different agents concurrently and heartbeats work until Runtime ACK', async () => {
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
    const startResolvers: Array<(outcome: { status: 'accepted' }) => void> = [];
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 100,
      leaseMs: 10,
      heartbeatMs: 3,
      submit: () => ({
        disposition: 'accepted',
        handled: true,
        started: new Promise((resolve) => startResolvers.push(resolve)),
        completion: new Promise(() => {}),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(startResolvers).toHaveLength(2);
    expect(inbox.get(first.id)?.status).toBe('claimed');
    expect(inbox.get(second.id)?.status).toBe('claimed');
    await vi.advanceTimersByTimeAsync(25);
    expect(inbox.releaseExpiredClaims()).toBe(0);
    startResolvers.forEach((resolve) => resolve({ status: 'accepted' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(inbox.get(first.id)?.status).toBe('admitted');
    expect(inbox.get(second.id)?.status).toBe('admitted');
    scheduler.stop();
  });

  it('stops admission heartbeats so another scheduler can recover the lease', async () => {
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
        started: new Promise(() => {}),
        completion: new Promise(() => {}),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)?.status).toBe('claimed');
    scheduler.stop();
    await vi.advanceTimersByTimeAsync(11);
    expect(inbox.releaseExpiredClaims()).toBe(1);
  });

  it('shares an in-flight Runtime start result for Invocation Pipeline duplicates', async () => {
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
        started: new Promise((resolve) => {
          resolveOutcome = resolve;
        }),
        // The scheduler owns only the start lease; Invocation completion may outlive it.
        completion: new Promise(() => {}),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)?.status).toBe('claimed');
    resolveOutcome({ status: 'failed', reasonCode: 'internal_error' });
    await Promise.resolve();
    await Promise.resolve();
    expect(inbox.get(item.id)?.status).toBe('expired');
    scheduler.stop();
  });

  it('backs off repeated busy-lane retries instead of hot-looping', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'busy-backoff',
      command: { source: 'system', prompt: 'Wait for the active turn' },
    });
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 1,
      retryDelayMs: 10,
      maxRetryDelayMs: 100,
      submit: () => ({
        disposition: 'deferred',
        handled: false,
        started: Promise.resolve({ status: 'deferred', reasonCode: 'agent_busy' }),
        completion: Promise.resolve({ status: 'deferred', reasonCode: 'agent_busy' }),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'released',
      attemptCount: 1,
      availableAt: '2026-07-25T02:00:00.010Z',
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'released',
      attemptCount: 2,
      availableAt: '2026-07-25T02:00:00.030Z',
    });
    scheduler.stop();
  });

  it('fences Runtime acknowledgement when a claimed work item is cancelled', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'cancel-before-ack',
      command: { source: 'workflow', prompt: 'Start carefully', taskId: 'TASK-1' },
    });
    let capturedSignal: AbortSignal | undefined;
    let canAcknowledge: (() => boolean) | undefined;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 100,
      leaseMs: 30,
      heartbeatMs: 5,
      submit: (_trigger, options) => {
        capturedSignal = options?.signal;
        canAcknowledge = options?.canAcknowledge;
        return {
          disposition: 'accepted',
          handled: true,
          started: new Promise(() => {}),
          completion: new Promise(() => {}),
        };
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(canAcknowledge?.()).toBe(true);
    expect(inbox.cancelForTerminalTask('project-1', 'TASK-1')).toBe(1);
    expect(canAcknowledge?.()).toBe(false);
    await vi.advanceTimersByTimeAsync(5);
    expect(capturedSignal?.aborted).toBe(true);
    expect(inbox.get(item.id)?.status).toBe('cancelled');
    scheduler.stop();
  });

  it('retries bounded Runtime startup failures before expiring the work', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'runtime-start-retry',
      command: { source: 'system', prompt: 'Recover Runtime startup' },
    });
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 1,
      retryDelayMs: 5,
      maxStartAttempts: 2,
      submit: () => ({
        disposition: 'accepted',
        handled: true,
        started: Promise.resolve({ status: 'failed', reasonCode: 'runtime_start_failed' }),
        completion: Promise.resolve({ status: 'failed', reasonCode: 'runtime_start_failed' }),
      }),
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)).toMatchObject({ status: 'released', attemptCount: 1 });
    await vi.advanceTimersByTimeAsync(5);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'expired',
      attemptCount: 2,
      runtimeStartFailureCount: 2,
      lastError: 'runtime_start_failed',
    });
    scheduler.stop();
  });

  it('admits the same durable work after one real Runtime startup retry succeeds', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'runtime-start-recovers',
      command: { source: 'system', prompt: 'Retry once' },
    });
    let submissions = 0;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 1,
      retryDelayMs: 5,
      maxStartAttempts: 3,
      submit: () => {
        submissions += 1;
        const outcome = submissions === 1
          ? { status: 'failed' as const, reasonCode: 'runtime_start_failed' as const }
          : { status: 'accepted' as const };
        return {
          disposition: 'accepted',
          handled: true,
          started: Promise.resolve(outcome),
          completion: Promise.resolve(outcome),
        };
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'released',
      runtimeStartFailureCount: 1,
    });
    await vi.advanceTimersByTimeAsync(5);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'admitted',
      runtimeStartFailureCount: 1,
    });
    expect(submissions).toBe(2);
    scheduler.stop();
  });

  it('does not spend the Runtime startup budget on busy-lane claims', async () => {
    const item = inbox.enqueue({
      projectId: 'project-1',
      projectAgentId: 'implementer',
      idempotencyKey: 'separate-start-budget',
      command: { source: 'system', prompt: 'Wait, then start' },
    });
    let submissions = 0;
    const scheduler = new AgentInboxScheduler({
      inbox,
      intervalMs: 1,
      retryDelayMs: 1,
      maxStartAttempts: 2,
      submit: () => {
        submissions += 1;
        const outcome = submissions <= 2
          ? { status: 'deferred' as const, reasonCode: 'agent_busy' as const }
          : { status: 'failed' as const, reasonCode: 'runtime_start_failed' as const };
        return {
          disposition: outcome.status === 'deferred' ? 'deferred' : 'accepted',
          handled: outcome.status !== 'deferred',
          started: Promise.resolve(outcome),
          completion: Promise.resolve(outcome),
        };
      },
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'released',
      attemptCount: 3,
      runtimeStartFailureCount: 1,
    });
    await vi.advanceTimersByTimeAsync(4);
    expect(inbox.get(item.id)).toMatchObject({
      status: 'expired',
      attemptCount: 4,
      runtimeStartFailureCount: 2,
    });
    scheduler.stop();
  });
});
