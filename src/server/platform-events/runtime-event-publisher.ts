import {
  isRuntimeLifecycleEventType,
  type PlatformEvent,
  type RuntimeEventPayload,
  type RuntimeEventType,
} from './types';
import { PlatformEventLog } from './event-log';

export class RuntimeEventStateError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RuntimeEventStateError';
  }
}

export interface RuntimeEventPublisherContext {
  projectId: string;
  projectAgentId: string;
  invocationId: string;
  logicalSessionId?: string;
  runtimeActorId: string;
  correlationId: string;
  causationId?: string;
}

export class RuntimeEventPublisher {
  private readonly streamKey: string;

  constructor(
    private readonly log: PlatformEventLog,
    private readonly context: RuntimeEventPublisherContext,
  ) {
    this.streamKey = `invocation:${context.invocationId}`;
  }

  publish<TType extends RuntimeEventType>(
    type: TType,
    payload: RuntimeEventPayload<TType>,
  ): PlatformEvent<TType, RuntimeEventPayload<TType>> {
    const dedupeKey = type === 'runtime.invocation.accepted'
      ? `runtime:${this.context.invocationId}:accepted`
      : type === 'runtime.invocation.started'
        ? `runtime:${this.context.invocationId}:started`
        : type === 'runtime.invocation.terminated'
          ? `runtime:${this.context.invocationId}:terminated`
          : undefined;

    return this.append(type, payload, dedupeKey);
  }

  private append<TType extends RuntimeEventType>(
    type: TType,
    payload: RuntimeEventPayload<TType>,
    dedupeKey?: string,
  ): PlatformEvent<TType, RuntimeEventPayload<TType>> {
    return this.log.append({
      type,
      category: isRuntimeLifecycleEventType(type)
        ? 'runtime_lifecycle'
        : 'runtime_activity',
      projectId: this.context.projectId,
      streamKey: this.streamKey,
      aggregate: { type: 'invocation', id: this.context.invocationId },
      actor: { type: 'runtime', id: this.context.runtimeActorId },
      subject: this.context.logicalSessionId
        ? { type: 'logical_session', id: this.context.logicalSessionId }
        : undefined,
      projectAgentId: this.context.projectAgentId,
      invocationId: this.context.invocationId,
      correlationId: this.context.correlationId,
      causationId: this.context.causationId,
      dedupeKey,
      payload,
    }, (events) => {
      const accepted = events.some((event) => event.type === 'runtime.invocation.accepted');
      const started = events.some((event) => event.type === 'runtime.invocation.started');
      const terminated = events.some((event) => event.type === 'runtime.invocation.terminated');

      if (type === 'runtime.invocation.accepted') {
        if (events.length > 0) {
          throw new RuntimeEventStateError(
            'runtime_event_acceptance_out_of_order',
            'Invocation acceptance must be the first Runtime event',
          );
        }
        return;
      }
      if (!accepted) {
        throw new RuntimeEventStateError(
          'runtime_event_invocation_not_accepted',
          `Cannot publish ${type} before invocation acceptance`,
        );
      }
      if (terminated) {
        throw new RuntimeEventStateError(
          'runtime_event_after_terminal',
          `Cannot publish ${type} after invocation termination`,
        );
      }
      if (!isRuntimeLifecycleEventType(type) && !started) {
        throw new RuntimeEventStateError(
          'runtime_event_invocation_not_started',
          `Cannot publish ${type} before invocation start`,
        );
      }
    });
  }
}
