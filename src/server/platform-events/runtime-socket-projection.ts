import type { PlatformEvent } from './types';
import type { ProjectViewEventInput } from '../../shared/project-view-events';

export interface RuntimeSocketProjectionPort {
  publish(projectId: string, event: ProjectViewEventInput): unknown;
}

/**
 * Live, best-effort Socket projection from canonical Runtime Events. Text and
 * thinking deltas are published by the live bridge through the same project:view
 * envelope; their durable boundary remains runtime.*.segment.completed.
 */
export class RuntimeSocketProjection {
  constructor(private readonly port: RuntimeSocketProjectionPort) {}

  project(event: PlatformEvent): void {
    const base = {
      eventId: event.eventId,
      occurredAt: event.occurredAt,
      delivery: 'durable' as const,
      actor: event.actor,
      agent: event.projectAgentId
        ? { type: 'agent' as const, id: event.projectAgentId }
        : undefined,
      subject: event.invocationId
        ? { type: 'invocation' as const, id: event.invocationId }
        : event.subject,
      correlationId: event.correlationId,
      causationId: event.causationId ?? event.eventId,
      source: {
        eventId: event.eventId,
        streamKey: event.streamKey,
        streamSequence: event.streamSequence,
      },
    };
    if (event.type === 'runtime.session.bound' || event.type === 'runtime.session.confirmed') {
      const payload = event.payload as { runtimeSessionId?: string; binding?: 'created' | 'resumed' };
      const canAnnounce = event.type === 'runtime.session.confirmed' || payload.binding === 'resumed';
      if (canAnnounce && payload.runtimeSessionId && event.projectAgentId) {
        this.port.publish(event.projectId, {
          ...base,
          type: 'runtime.session',
          payload: { sessionId: payload.runtimeSessionId },
        });
      }
      return;
    }
    if (event.type === 'runtime.plan.updated') {
      this.port.publish(event.projectId, {
        ...base,
        type: 'runtime.plan',
        payload: { content: (event.payload as { content?: string }).content ?? '' },
      });
    } else if (event.type === 'runtime.tool.started') {
      const payload = event.payload as { callId: string; toolName: string; input?: string };
      this.port.publish(event.projectId, {
        ...base,
        type: 'runtime.tool.started',
        payload: {
          callId: payload.callId,
          toolName: payload.toolName,
          input: payload.input,
        },
      });
    } else if (event.type === 'runtime.tool.completed' || event.type === 'runtime.tool.failed') {
      const payload = event.payload as {
        callId: string;
        toolName: string;
        output?: string;
        message?: string;
      };
      this.port.publish(event.projectId, {
        ...base,
        type: event.type === 'runtime.tool.failed'
          ? 'runtime.tool.failed'
          : 'runtime.tool.completed',
        payload: {
          callId: payload.callId,
          toolName: payload.toolName,
          output: payload.output ?? payload.message,
        },
      });
    } else if (
      event.type === 'runtime.warning.raised'
      || event.type === 'runtime.diagnostic.observed'
      || event.type === 'runtime.transport.degraded'
      || event.type === 'runtime.session.resume_failed'
      || event.type === 'runtime.invocation.blocked'
    ) {
      this.port.publish(event.projectId, {
        ...base,
        type: 'runtime.warning',
        payload: event.payload as Record<string, unknown>,
      });
    } else if (event.type === 'runtime.usage.updated') {
      this.port.publish(event.projectId, {
        ...base,
        type: 'runtime.usage',
        payload: event.payload as Record<string, unknown>,
      });
    } else if (event.type === 'runtime.invocation.terminated') {
      this.port.publish(event.projectId, {
        ...base,
        type: 'runtime.completed',
        payload: event.payload as Record<string, unknown>,
      });
    }
  }
}
