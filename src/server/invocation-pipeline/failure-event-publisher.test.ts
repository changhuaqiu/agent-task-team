// Invocation Pipeline failure normalization tests.
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { InvocationFailureEventPublisher } from './failure-event-publisher';
import type { AgentActivationCommand } from './types';

describe('InvocationFailureEventPublisher', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let publisher: InvocationFailureEventPublisher;
  let id = 0;
  const trigger: AgentActivationCommand = {
    id: 'activation-1',
    source: 'user',
    conversationId: 'project-1',
    agentId: 'implementer',
    prompt: 'continue',
    workId: 'attempt-1',
  };

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({
      db,
      now: () => new Date(now),
      idFactory: () => `pev-${++id}`,
    });
    publisher = new InvocationFailureEventPublisher({
      eventLog: log,
      runtimeActorId: 'daemon-1',
    });
  });

  afterEach(() => db.close());

  it('publishes runtime_profile_missing as an Invocation preflight block', () => {
    publisher.publish(trigger, {
      status: 'blocked',
      reasonCode: 'runtime_profile_missing',
      message: 'No configured account',
    });

    const events = log.listByInvocation('attempt-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'runtime.invocation.blocked',
      category: 'runtime_lifecycle',
      invocationId: 'attempt-1',
      projectAgentId: 'implementer',
      payload: {
        phase: 'preflight',
        reasonCode: 'runtime_profile_missing',
        message: 'No configured account',
      },
    });
  });

  it('publishes required_context_missing with structured missing fields', () => {
    publisher.publish(trigger, {
      status: 'failed',
      reasonCode: 'required_context_missing',
      message: 'Required context is incomplete',
      evidence: {
        traceId: 'trace-1',
        snapshotId: 'snapshot-1',
        missingRequired: ['task.description', 'work_contract'],
      },
    });

    const events = log.listStream('context_snapshot:snapshot-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'context.snapshot.rejected',
      category: 'coordination',
      correlationId: 'trace-1',
      payload: {
        reasonCode: 'required_context_missing',
        missingRequired: ['task.description', 'work_contract'],
      },
    });
  });
});
