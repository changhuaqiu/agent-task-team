import { describe, expect, it, vi } from 'vitest';
import { ProjectViewPublisher } from './project-view-publisher';

describe('ProjectViewPublisher', () => {
  it('publishes an isolated, versioned envelope to the project room', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const publisher = new ProjectViewPublisher({ to });

    const envelope = publisher.publish('project-a', {
      type: 'runtime.plan',
      delivery: 'durable',
      actor: { type: 'agent', id: 'mario' },
      subject: { type: 'invocation', id: 'inv-1' },
      eventId: 'event-1',
      correlationId: 'inv-1',
      causationId: 'command-1',
      payload: { content: 'plan' },
    });

    expect(to).toHaveBeenCalledWith('project-a');
    expect(emit).toHaveBeenCalledWith('project:view', envelope);
    expect(envelope).toMatchObject({
      version: 2,
      envelopeVersion: 1,
      projectId: 'project-a',
      type: 'runtime.plan',
      delivery: 'durable',
      actor: { type: 'agent', id: 'mario' },
      subject: { type: 'invocation', id: 'inv-1' },
      eventId: 'event-1',
      causationId: 'command-1',
    });
    expect(envelope.occurredAt).toBeTruthy();
  });

  it('rejects events without a project identity', () => {
    const publisher = new ProjectViewPublisher({
      to: vi.fn(() => ({ emit: vi.fn() })),
    });

    expect(() => publisher.publish('  ', {
      type: 'runtime.warning',
      delivery: 'transient',
      actor: { type: 'system', id: 'test' },
      correlationId: 'root-event',
      causationId: 'root-event',
      payload: { message: 'no project' },
    })).toThrow('project_view_project_id_required');
  });

  it('rejects a projection without explicit correlation', () => {
    const publisher = new ProjectViewPublisher({
      to: vi.fn(() => ({ emit: vi.fn() })),
    });

    expect(() => publisher.publish('project-a', {
      type: 'runtime.warning',
      delivery: 'transient',
      actor: { type: 'system', id: 'test' },
      correlationId: '',
      causationId: 'root-event',
      payload: { message: 'uncorrelated' },
    })).toThrow('project_view_correlation_id_required');
  });

  it('rejects a projection without explicit causation', () => {
    const publisher = new ProjectViewPublisher({
      to: vi.fn(() => ({ emit: vi.fn() })),
    });

    expect(() => publisher.publish('project-a', {
      type: 'runtime.warning',
      delivery: 'transient',
      actor: { type: 'system', id: 'test' },
      correlationId: 'trace-1',
      causationId: '',
      payload: { message: 'uncaused' },
    })).toThrow('project_view_causation_id_required');
  });
});
