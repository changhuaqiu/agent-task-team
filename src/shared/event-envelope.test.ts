import { describe, expect, it } from 'vitest';
import {
  EVENT_ENVELOPE_VERSION,
  isEventEnvelope,
  isIdentityRef,
} from './event-envelope';

describe('event envelope', () => {
  const event = {
    eventId: 'event-1',
    type: 'task.ready',
    envelopeVersion: EVENT_ENVELOPE_VERSION,
    projectId: 'project-1',
    actor: { type: 'agent', id: 'agent-1' },
    subject: { type: 'task', id: 'task-1' },
    correlationId: 'trace-1',
    causationId: 'command-1',
    occurredAt: '2026-08-23T00:00:00.000Z',
    payload: { status: 'ready' },
  } as const;

  it('accepts one scoped identity and causality shape', () => {
    expect(isIdentityRef(event.actor)).toBe(true);
    expect(isEventEnvelope(event)).toBe(true);
  });

  it('rejects missing scope and ambiguous identity', () => {
    expect(isEventEnvelope({ ...event, projectId: '' })).toBe(false);
    expect(isEventEnvelope({ ...event, actor: { id: 'agent-1' } })).toBe(false);
  });
});
