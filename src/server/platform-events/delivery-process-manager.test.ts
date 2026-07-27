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
});
