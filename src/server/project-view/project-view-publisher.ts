import { randomUUID } from 'node:crypto';
import { EVENT_ENVELOPE_VERSION } from '../../shared/event-envelope';
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
  constructor(
    private readonly io: ProjectRoomEmitter,
    private readonly idFactory: () => string = () => `pve-${randomUUID()}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  publish(projectId: string, event: ProjectViewEventInput): ProjectViewEnvelope {
    const normalizedProjectId = projectId.trim();
    if (!normalizedProjectId) {
      throw new Error('project_view_project_id_required');
    }
    const eventId = event.eventId?.trim() || this.idFactory();
    const correlationId = typeof event.correlationId === 'string'
      ? event.correlationId.trim()
      : '';
    if (!correlationId) {
      throw new Error('project_view_correlation_id_required');
    }
    const causationId = typeof event.causationId === 'string'
      ? event.causationId.trim()
      : '';
    if (!causationId) {
      throw new Error('project_view_causation_id_required');
    }
    const envelope: ProjectViewEnvelope = {
      version: PROJECT_VIEW_VERSION,
      envelopeVersion: EVENT_ENVELOPE_VERSION,
      eventId,
      type: event.type,
      projectId: normalizedProjectId,
      delivery: event.delivery,
      actor: event.actor,
      ...(event.agent ? { agent: event.agent } : {}),
      ...(event.subject ? { subject: event.subject } : {}),
      correlationId,
      causationId,
      occurredAt: event.occurredAt ?? this.now().toISOString(),
      payload: event.payload,
      ...(event.source ? { source: event.source } : {}),
    };
    this.io.to(normalizedProjectId).emit(PROJECT_VIEW_CHANNEL, envelope);
    return envelope;
  }
}

export function publishProjectView(
  io: ProjectRoomEmitter,
  projectId: string,
  event: ProjectViewEventInput,
): ProjectViewEnvelope {
  return new ProjectViewPublisher(io).publish(projectId, event);
}
