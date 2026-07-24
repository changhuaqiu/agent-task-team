import type { PlatformEvent } from './types';

export interface RuntimeSocketProjectionPort {
  emit(event: string, payload: unknown): void;
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
      conversationId: event.projectId,
      agentId: event.projectAgentId,
      invocationId: event.invocationId,
    };
    if (event.type === 'runtime.session.bound' || event.type === 'runtime.session.confirmed') {
      const payload = event.payload as { runtimeSessionId?: string; binding?: 'created' | 'resumed' };
      const canAnnounce = event.type === 'runtime.session.confirmed' || payload.binding === 'resumed';
      if (canAnnounce && payload.runtimeSessionId && event.projectAgentId) {
        this.port.emit('agent:session', {
          projectId: event.projectId,
          conversationId: event.projectId,
          agentId: event.projectAgentId,
          sessionId: payload.runtimeSessionId,
        });
      }
      return;
    }
    if (event.type === 'runtime.plan.updated') {
      this.port.emit('agent:event', {
        ...base,
        type: 'plan',
        content: (event.payload as { content?: string }).content ?? '',
      });
    } else if (event.type === 'runtime.tool.started') {
      const payload = event.payload as { callId: string; toolName: string; input?: string };
      this.port.emit('agent:event', {
        ...base,
        type: 'tool_use',
        tool: {
          callId: payload.callId,
          name: payload.toolName,
          input: payload.input,
          status: 'in_progress',
        },
      });
    } else if (event.type === 'runtime.tool.completed' || event.type === 'runtime.tool.failed') {
      const payload = event.payload as {
        callId: string;
        toolName: string;
        output?: string;
        message?: string;
      };
      this.port.emit('agent:event', {
        ...base,
        type: 'tool_result',
        content: payload.output ?? payload.message ?? '',
        tool: {
          callId: payload.callId,
          name: payload.toolName,
          output: payload.output ?? payload.message,
          status: event.type === 'runtime.tool.failed' ? 'failed' : 'completed',
        },
      });
    } else if (event.type === 'runtime.warning.raised') {
      this.port.emit('agent:event', {
        ...base,
        type: 'error',
        content: (event.payload as { message?: string }).message ?? '',
      });
    } else if (event.type === 'runtime.usage.updated') {
      this.port.emit('agent:event', {
        ...base,
        type: 'usage',
        usage: event.payload,
      });
    } else if (event.type === 'runtime.invocation.terminated') {
      this.port.emit('agent:event', { ...base, type: 'done' });
    }
  }
}
