export const PLATFORM_EVENT_SCHEMA_VERSION = 1 as const;

export type PlatformEventCategory =
  | 'domain'
  | 'coordination'
  | 'runtime_lifecycle'
  | 'runtime_activity';

export type PlatformEventActorType = 'user' | 'agent' | 'system' | 'runtime';

export interface EventObjectRef {
  type: string;
  id: string;
}

export interface EventAggregateRef extends EventObjectRef {
  version?: number;
}

export interface PlatformEvent<TType extends string = string, TPayload = unknown> {
  eventId: string;
  type: TType;
  category: PlatformEventCategory;
  schemaVersion: typeof PLATFORM_EVENT_SCHEMA_VERSION;
  projectId: string;
  streamKey: string;
  streamSequence: number;
  aggregate: EventAggregateRef;
  actor: {
    type: PlatformEventActorType;
    id: string;
  };
  subject?: EventObjectRef;
  projectAgentId?: string;
  invocationId?: string;
  inboxItemId?: string;
  correlationId: string;
  causationId?: string;
  dedupeKey?: string;
  occurredAt: string;
  recordedAt: string;
  payload: TPayload;
}

export interface AppendPlatformEvent<TType extends string = string, TPayload = unknown> {
  type: TType;
  category: PlatformEventCategory;
  projectId: string;
  streamKey: string;
  aggregate: EventAggregateRef;
  actor: {
    type: PlatformEventActorType;
    id: string;
  };
  subject?: EventObjectRef;
  projectAgentId?: string;
  invocationId?: string;
  inboxItemId?: string;
  correlationId: string;
  causationId?: string;
  dedupeKey?: string;
  occurredAt?: string;
  payload: TPayload;
}

export interface RuntimeLifecyclePayloadMap {
  'runtime.invocation.accepted': {
    envelopeId?: string;
    runtimeNodeId?: string;
  };
  'runtime.invocation.started': {
    adapter: 'acp';
    engine: 'opencode' | 'claude' | 'codex';
  };
  'runtime.session.bound': {
    logicalSessionId: string;
    runtimeSessionId: string;
    binding: 'created' | 'resumed';
  };
  'runtime.session.confirmed': {
    runtimeSessionId: string;
  };
  'runtime.session.invalidated': {
    runtimeSessionId: string;
    reasonCode: string;
  };
  'runtime.invocation.terminated': {
    outcome: 'completed' | 'failed' | 'cancelled' | 'timed_out';
    reasonCode?: string;
    durationMs: number;
    runtimeSessionId?: string;
    usage?: Record<string, { inputTokens: number; outputTokens: number }>;
  };
}

export interface RuntimeActivityPayloadMap {
  'runtime.message.segment.completed': {
    segmentId: string;
    text: string;
  };
  'runtime.thinking.segment.completed': {
    segmentId: string;
    text: string;
  };
  'runtime.plan.updated': {
    content: string;
  };
  'runtime.tool.started': {
    callId: string;
    toolName: string;
    input?: string;
    origin: 'runtime' | 'platform';
  };
  'runtime.tool.completed': {
    callId: string;
    toolName: string;
    output?: string;
  };
  'runtime.tool.failed': {
    callId: string;
    toolName: string;
    reasonCode: string;
    message?: string;
  };
  'runtime.permission.requested': {
    requestId: string;
    callId?: string;
    options: string[];
  };
  'runtime.permission.resolved': {
    requestId: string;
    decision: 'allowed' | 'denied';
    source: 'policy' | 'user';
  };
  'runtime.usage.updated': {
    inputTokens: number;
    outputTokens: number;
  };
  'runtime.warning.raised': {
    reasonCode: string;
    message: string;
    recoverable: boolean;
  };
}

export type RuntimeLifecycleEventType = keyof RuntimeLifecyclePayloadMap;
export type RuntimeActivityEventType = keyof RuntimeActivityPayloadMap;
export type RuntimeEventType = RuntimeLifecycleEventType | RuntimeActivityEventType;
export type RuntimeEventPayload<TType extends RuntimeEventType> =
  TType extends RuntimeLifecycleEventType
    ? RuntimeLifecyclePayloadMap[TType]
    : TType extends RuntimeActivityEventType
      ? RuntimeActivityPayloadMap[TType]
      : never;

export const RUNTIME_LIFECYCLE_EVENT_TYPES: ReadonlySet<RuntimeLifecycleEventType> = new Set([
  'runtime.invocation.accepted',
  'runtime.invocation.started',
  'runtime.session.bound',
  'runtime.session.confirmed',
  'runtime.session.invalidated',
  'runtime.invocation.terminated',
]);

export function isRuntimeLifecycleEventType(
  type: RuntimeEventType,
): type is RuntimeLifecycleEventType {
  return RUNTIME_LIFECYCLE_EVENT_TYPES.has(type as RuntimeLifecycleEventType);
}
