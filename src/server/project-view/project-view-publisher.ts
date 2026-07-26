import {
  PROJECT_VIEW_CHANNEL,
  PROJECT_VIEW_VERSION,
  type ProjectViewEnvelope,
  type ProjectViewEventInput,
} from '../../shared/project-view-events';

export interface ProjectRoomEmitter {
  to(projectId: string): {
    emit(channel: string, payload: unknown): void;
  };
}

/**
 * Best-effort presentation publisher. The small interface owns envelope
 * normalization and room selection so producers cannot accidentally broadcast
 * one project's runtime facts to every connected browser.
 */
export class ProjectViewPublisher {
  constructor(private readonly io: ProjectRoomEmitter) {}

  publish(projectId: string, event: ProjectViewEventInput): ProjectViewEnvelope {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      throw new Error('project_view_project_id_required');
    }
    const envelope: ProjectViewEnvelope = {
      ...event,
      version: PROJECT_VIEW_VERSION,
      projectId: normalizedProjectId,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
    };
    this.io.to(normalizedProjectId).emit(PROJECT_VIEW_CHANNEL, envelope);
    return envelope;
  }
}
