import type { PlatformEvent } from './types';
import type { ProjectViewEventInput } from '../../shared/project-view-events';

export interface RuntimeSocketProjectionPort {
  publish(projectId: string, event: ProjectViewEventInput): unknown;
}

/**
 * Live, best-effort Socket projection from canonical Runtime Events. Text and
 * thinking deltas intentionally remain on the separate transient delta path;
 * their durable boundary is runtime.*.segment.completed.
 */
export class RuntimeSocketProjection {
  constructor(private readonly port: RuntimeSocketProjectionPort) {}

  project(event: PlatformEvent): void {
    const base = {
      agentId: event.projectAgentId,
      invocationId: event.invocationId,
      eventId: event.eventId,
      occurredAt: event.occurredAt,
    };
    if (event.type === 'runtime.session.bound' || event.type === 'runtime.session.confirmed') {
      const payload = event.payload as { runtimeSessionId?: string; binding?: 'created' | 'resumed' };
      const canAnnounce = event.type === 'runtime.session.confirmed' || payload.binding === 'resumed';
      if (canAnnounce && payload.runtimeSessionId && event.projectAgentId) {
        this.port.publish(event.projectId, {
          ...base,
          kind: 'runtime.session',
          payload: { sessionId: payload.runtimeSessionId },
        });
      }
      return;
    }
    if (event.type === 'runtime.plan.updated') {
      this.port.publish(event.projectId, {
        ...base,
        kind: 'runtime.plan',
        payload: { content: (event.payload as { content?: string }).content ?? '' },
      });
    } else if (event.type === 'runtime.tool.started') {
      const payload = event.payload as { callId: string; toolName: string; input?: string };
      this.port.publish(event.projectId, {
        ...base,
        kind: 'runtime.tool.started',
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
        kind: event.type === 'runtime.tool.failed'
          ? 'runtime.tool.failed'
          : 'runtime.tool.completed',
        payload: {
          callId: payload.callId,
          toolName: payload.toolName,
          output: payload.output ?? payload.message,
        },
      });
    } else if (event.type === 'runtime.warning.raised') {
      this.port.publish(event.projectId, {
        ...base,
        kind: 'runtime.warning',
        payload: event.payload as Record<string, unknown>,
      });
    } else if (event.type === 'runtime.usage.updated') {
      this.port.publish(event.projectId, {
        ...base,
        kind: 'runtime.usage',
        payload: event.payload as Record<string, unknown>,
      });
    } else if (event.type === 'runtime.invocation.terminated') {
      this.port.publish(event.projectId, {
        ...base,
        kind: 'runtime.completed',
        payload: event.payload as Record<string, unknown>,
      });
    }
  }
}
