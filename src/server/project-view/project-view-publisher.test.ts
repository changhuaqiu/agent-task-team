import { describe, expect, it, vi } from 'vitest';
import { ProjectViewPublisher } from './project-view-publisher';

describe('ProjectViewPublisher', () => {
  it('publishes an isolated, versioned envelope to the project room', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));
    const publisher = new ProjectViewPublisher({ to });

    const envelope = publisher.publish('project-a', {
      kind: 'runtime.plan',
      agentId: 'mario',
      eventId: 'event-1',
      payload: { content: 'plan' },
    });

    expect(to).toHaveBeenCalledWith('project-a');
    expect(emit).toHaveBeenCalledWith('project:view', envelope);
    expect(envelope).toMatchObject({
      version: 1,
      projectId: 'project-a',
      kind: 'runtime.plan',
      agentId: 'mario',
      eventId: 'event-1',
    });
    expect(envelope.occurredAt).toBeTruthy();
  });

  it('rejects events without a project identity', () => {
    const publisher = new ProjectViewPublisher({
      to: vi.fn(() => ({ emit: vi.fn() })),
    });

    expect(() => publisher.publish('  ', {
      kind: 'runtime.warning',
      payload: { message: 'no project' },
    })).toThrow('project_view_project_id_required');
  });
});
