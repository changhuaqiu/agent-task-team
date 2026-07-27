import { describe, expect, it, vi } from 'vitest';
import { DeliveryProcessManager } from './delivery-process-manager';
import type { PlatformEvent } from './types';

function taskEvent(): PlatformEvent {
  return {
    eventId: 'event-1',
    type: 'task.done',
    category: 'domain',
    schemaVersion: 1,
    projectId: 'project-1',
    streamKey: 'task:task-1',
    streamSequence: 1,
    aggregate: { type: 'task', id: 'task-1' },
    actor: { type: 'system', id: 'task-domain' },
    correlationId: 'task-1',
    occurredAt: '2026-07-25T04:00:00.000Z',
    recordedAt: '2026-07-25T04:00:00.000Z',
    payload: {},
  };
}

function gateEvent(): PlatformEvent {
  return {
    ...taskEvent(),
    eventId: 'event-gate',
    type: 'gate.passed',
    streamKey: 'quality_gate:gate-1',
    aggregate: { type: 'quality_gate', id: 'gate-1' },
    subject: { type: 'task', id: 'task-1' },
  };
}

function recoveryEvent(
  type: 'runtime.invocation.blocked' | 'runtime.session.resume_failed' | 'context.snapshot.rejected',
): PlatformEvent {
  return {
    ...taskEvent(),
    eventId: `event-${type}`,
    type,
    category: type.startsWith('context.') ? 'coordination' : 'runtime_lifecycle',
    streamKey: type.startsWith('context.') ? 'context_snapshot:snapshot-1' : 'invocation:attempt-1',
    aggregate: type.startsWith('context.')
      ? { type: 'context_snapshot', id: 'snapshot-1' }
      : { type: 'invocation', id: 'attempt-1' },
    subject: type.startsWith('context.')
      ? { type: 'invocation_attempt', id: 'attempt-1' }
      : undefined,
    invocationId: type.startsWith('runtime.') ? 'attempt-1' : undefined,
  };
}

describe('DeliveryProcessManager', () => {
  it('maps a task fact to the supervisor interface without writing delivery tables', async () => {
    const advanceProject = vi.fn(async () => ({ status: 'advanced' }));
    const manager = new DeliveryProcessManager({ advanceProject });
    const signal = new AbortController().signal;

    await manager.handle(taskEvent(), { signal });

    expect(advanceProject).toHaveBeenCalledWith('project-1', {
      kind: 'fact_changed',
      ref: 'task-1',
    }, signal, 'event-1');
  });

  it('does not admit work after cancellation', async () => {
    const advanceProject = vi.fn();
    const manager = new DeliveryProcessManager({ advanceProject });
    const controller = new AbortController();
    controller.abort(new Error('stop'));

    await expect(manager.handle(taskEvent(), { signal: controller.signal })).rejects.toThrow('stop');
    expect(advanceProject).not.toHaveBeenCalled();
  });

  it('advances immediately from a gate fact using the reviewed task as cause', async () => {
    const advanceProject = vi.fn();
    const manager = new DeliveryProcessManager({ advanceProject });
    const signal = new AbortController().signal;

    await manager.handle(gateEvent(), { signal });

    expect(advanceProject).toHaveBeenCalledWith(
      'project-1',
      { kind: 'fact_changed', ref: 'task-1' },
      signal,
      'event-gate',
    );
  });

  it.each([
    'runtime.invocation.blocked',
    'runtime.session.resume_failed',
    'context.snapshot.rejected',
  ] as const)('reconciles a Delivery from normalized recovery fact %s', async (type) => {
    const advanceProject = vi.fn();
    const manager = new DeliveryProcessManager({ advanceProject });
    const signal = new AbortController().signal;

    await manager.handle(recoveryEvent(type), { signal });

    expect(advanceProject).toHaveBeenCalledWith(
      'project-1',
      { kind: 'fact_changed', ref: 'attempt-1' },
      signal,
      `event-${type}`,
    );
  });

  it('does not let raw diagnostics drive Delivery transitions', async () => {
    const advanceProject = vi.fn();
    const manager = new DeliveryProcessManager({ advanceProject });

    await manager.handle({
      ...taskEvent(),
      type: 'runtime.diagnostic.observed',
      category: 'runtime_activity',
      invocationId: 'attempt-1',
    }, { signal: new AbortController().signal });

    expect(advanceProject).not.toHaveBeenCalled();
  });
});
