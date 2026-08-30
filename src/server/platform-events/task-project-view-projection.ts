import type { Server as IOServer } from 'socket.io';
import { publishProjectView } from '../project-view/project-view-publisher';
import { taskRepo } from '../repositories/task-repo';
import type { PlatformEventHandler } from './dispatcher';

/** Projects every authoritative Task fact to the desktop's isolated Project channel. */
export class TaskProjectViewProjection {
  constructor(private readonly io: IOServer) {}

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.category !== 'domain' || !event.type.startsWith('task.')) return;
    if (signal.aborted) throw signal.reason ?? new Error('task_project_view_projection_aborted');
    const task = taskRepo.getById(event.aggregate.id);
    if (!task || task.conversation_id !== event.projectId) return;
    publishProjectView(this.io, event.projectId, {
      type: 'task.state',
      delivery: 'durable',
      actor: event.actor,
      subject: { type: 'task', id: task.id },
      eventId: `${event.eventId}:task-state`,
      correlationId: event.correlationId,
      causationId: event.eventId,
      occurredAt: event.recordedAt,
      payload: { task },
    });
  };
}
