import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventDedupeConflictError, PlatformEventLog } from './event-log';
import { RuntimeEventPublisher, RuntimeEventStateError } from './runtime-event-publisher';

describe('RuntimeEventPublisher', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let publisher: RuntimeEventPublisher;
  let id = 0;

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-07-24T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({
      db,
      now: () => new Date(now),
      idFactory: () => `pev-${++id}`,
    });
    publisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      logicalSessionId: 'session-1',
      runtimeActorId: 'local-daemon',
      correlationId: 'envelope-1',
    });
  });

  afterEach(() => {
    db.close();
  });

  it('publishes an ordered Runtime lifecycle and activity stream', () => {
    publisher.publish('runtime.invocation.accepted', { envelopeId: 'envelope-1' });
    publisher.publish('runtime.invocation.started', {
      adapter: 'acp',
      engine: 'codex',
    });
    publisher.publish('runtime.message.segment.completed', {
      segmentId: 'message-1',
      text: 'hello',
    });
    publisher.publish('runtime.invocation.terminated', {
      outcome: 'completed',
      durationMs: 25,
      runtimeSessionId: 'runtime-session-1',
    });

    const events = log.listByInvocation('inv-1');
    expect(events.map((event) => event.type)).toEqual([
      'runtime.invocation.accepted',
      'runtime.invocation.started',
      'runtime.message.segment.completed',
      'runtime.invocation.terminated',
    ]);
    expect(events.map((event) => event.streamSequence)).toEqual([1, 2, 3, 4]);
    expect(events.every((event) => event.projectAgentId === 'implementer')).toBe(true);
  });

  it('requires acceptance before start or activity', () => {
    expect(() => publisher.publish('runtime.invocation.started', {
      adapter: 'acp',
      engine: 'codex',
    })).toThrow(RuntimeEventStateError);
  });

  it('records a preflight block as a terminal attempt without pretending Runtime started', () => {
    const blocked = publisher.publish('runtime.invocation.blocked', {
      phase: 'preflight',
      reasonCode: 'runtime_profile_missing',
    });

    expect(blocked.category).toBe('runtime_lifecycle');
    expect(() => publisher.publish('runtime.invocation.accepted', {
      envelopeId: 'envelope-1',
    })).toThrow('after Invocation preflight was blocked');
  });

  it('requires start before Runtime activity', () => {
    publisher.publish('runtime.invocation.accepted', { envelopeId: 'envelope-1' });
    expect(() => publisher.publish('runtime.message.segment.completed', {
      segmentId: 'message-1',
      text: 'hello',
    })).toThrow(RuntimeEventStateError);
  });

  it('rejects activity after the unique terminal event', () => {
    publisher.publish('runtime.invocation.accepted', { envelopeId: 'envelope-1' });
    publisher.publish('runtime.invocation.terminated', {
      outcome: 'failed',
      reasonCode: 'spawn_failed',
      durationMs: 5,
    });

    expect(() => publisher.publish('runtime.warning.raised', {
      reasonCode: 'late_warning',
      message: 'late',
      recoverable: false,
    })).toThrow(RuntimeEventStateError);
  });

  it('checks persisted lifecycle state when multiple publishers share an invocation', () => {
    const competingPublisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      logicalSessionId: 'session-1',
      runtimeActorId: 'local-daemon',
      correlationId: 'envelope-1',
    });
    publisher.publish('runtime.invocation.accepted', { envelopeId: 'envelope-1' });
    publisher.publish('runtime.invocation.started', { adapter: 'acp', engine: 'codex' });
    publisher.publish('runtime.invocation.terminated', {
      outcome: 'completed',
      durationMs: 10,
    });

    expect(() => competingPublisher.publish('runtime.message.segment.completed', {
      segmentId: 'late-message',
      text: 'late',
    })).toThrow(RuntimeEventStateError);
  });

  it('makes identical lifecycle retries idempotent and conflicting terminals fail', () => {
    const accepted = publisher.publish('runtime.invocation.accepted', {
      envelopeId: 'envelope-1',
    });
    expect(publisher.publish('runtime.invocation.accepted', {
      envelopeId: 'envelope-1',
    })).toEqual(accepted);

    const terminated = publisher.publish('runtime.invocation.terminated', {
      outcome: 'failed',
      reasonCode: 'spawn_failed',
      durationMs: 5,
    });
    expect(publisher.publish('runtime.invocation.terminated', {
      outcome: 'failed',
      reasonCode: 'spawn_failed',
      durationMs: 5,
    })).toEqual(terminated);
    expect(() => publisher.publish('runtime.invocation.terminated', {
      outcome: 'cancelled',
      reasonCode: 'cancelled',
      durationMs: 6,
    })).toThrow(PlatformEventDedupeConflictError);
  });
});
