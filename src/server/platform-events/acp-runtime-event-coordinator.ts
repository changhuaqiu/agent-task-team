import type { AgentEvent, AgentResult } from '../agent/types';
import { PlatformEventLog } from './event-log';
import { RuntimeAgentEventBridge } from './runtime-agent-event-bridge';
import {
  RuntimeEventPublisher,
  type RuntimeEventPublisherContext,
} from './runtime-event-publisher';
import type { RuntimeEventPayload, RuntimeEventType } from './types';

export interface AcpRuntimeEventCoordinatorOptions {
  context: RuntimeEventPublisherContext;
  engine: 'opencode' | 'claude' | 'codex';
  runtimeNodeId: string;
  envelopeId?: string;
  log?: PlatformEventLog;
  isPlatformTool?: (toolName: string) => boolean;
  now?: () => number;
  onPublishError?: (type: RuntimeEventType, error: unknown) => void;
}

/**
 * Owns the compatibility dual-write lifecycle for one ACP Invocation.
 * Daemon code supplies execution facts; this module preserves their ordering,
 * terminal uniqueness and adapter-to-canonical normalization.
 */
export class AcpRuntimeEventCoordinator {
  private readonly publisher: RuntimeEventPublisher;
  private readonly bridge: RuntimeAgentEventBridge;
  private readonly now: () => number;
  private acceptedAtMs?: number;

  constructor(private readonly options: AcpRuntimeEventCoordinatorOptions) {
    this.publisher = new RuntimeEventPublisher(
      options.log ?? new PlatformEventLog(),
      options.context,
    );
    this.bridge = new RuntimeAgentEventBridge({
      invocationId: options.context.invocationId,
      publish: (type, payload) => this.publish(type, payload),
      isPlatformTool: options.isPlatformTool,
    });
    this.now = options.now ?? Date.now;
  }

  accept(): void {
    this.acceptedAtMs = this.now();
    this.publish('runtime.invocation.accepted', {
      envelopeId: this.options.envelopeId,
      runtimeNodeId: this.options.runtimeNodeId,
    });
  }

  start(): void {
    this.publish('runtime.invocation.started', {
      adapter: 'acp',
      engine: this.options.engine,
    });
  }

  adapterEvent(event: AgentEvent): void {
    this.bridge.publish(event);
  }

  bindSession(
    logicalSessionId: string,
    runtimeSessionId: string,
    binding: 'created' | 'resumed',
  ): void {
    this.publish('runtime.session.bound', {
      logicalSessionId,
      runtimeSessionId,
      binding,
    });
  }

  confirmSession(runtimeSessionId: string): void {
    this.publish('runtime.session.confirmed', { runtimeSessionId });
  }

  terminate(final: Pick<
    AgentResult,
    'status' | 'reasonCode' | 'durationMs' | 'sessionId' | 'usage'
  >): void {
    this.bridge.flush();
    this.publish('runtime.invocation.terminated', {
      outcome: final.status === 'timeout' ? 'timed_out' : final.status,
      reasonCode: final.reasonCode,
      durationMs: final.durationMs,
      runtimeSessionId: final.sessionId,
      usage: final.usage,
    });
  }

  failSetup(reasonCode: string, runtimeSessionId?: string): void {
    this.bridge.flush();
    this.publish('runtime.invocation.terminated', {
      outcome: 'failed',
      reasonCode,
      durationMs: this.acceptedAtMs === undefined
        ? 0
        : Math.max(0, this.now() - this.acceptedAtMs),
      runtimeSessionId,
    });
  }

  private publish<TType extends RuntimeEventType>(
    type: TType,
    payload: RuntimeEventPayload<TType>,
  ): void {
    try {
      this.publisher.publish(type, payload);
    } catch (error) {
      // Compatibility dual-write remains fail-open until Runtime projections
      // become authoritative.
      this.options.onPublishError?.(type, error);
    }
  }
}
