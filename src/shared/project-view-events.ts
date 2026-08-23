import {
  EVENT_ENVELOPE_VERSION,
  isEventEnvelope,
  isIdentityRef,
  type EventEnvelope,
  type IdentityRef,
} from './event-envelope';

export const PROJECT_VIEW_CHANNEL = 'project:view' as const;
export const PROJECT_VIEW_VERSION = 2 as const;

export type ProjectViewEventKind =
  | 'runtime.session'
  | 'runtime.activity'
  | 'runtime.text.delta'
  | 'runtime.thinking.delta'
  | 'runtime.plan'
  | 'runtime.tool.started'
  | 'runtime.tool.completed'
  | 'runtime.tool.failed'
  | 'runtime.warning'
  | 'runtime.usage'
  | 'runtime.completed'
  | 'a2a.snapshot'
  | 'chat.message.persisted'
  | 'task.state'
  | 'task.notification'
  | 'task.wakeup'
  | 'task.sync'
  | 'task.sync_error'
  | 'dispatch.receipt'
  | 'terminal.output'
  | 'terminal.exited';

export interface ProjectViewEventInput {
  type: ProjectViewEventKind;
  delivery: 'durable' | 'transient';
  actor: IdentityRef;
  agent?: IdentityRef<'agent'>;
  subject?: IdentityRef<string>;
  correlationId: string;
  causationId: string;
  eventId?: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
  source?: {
    eventId: string;
    streamKey: string;
    streamSequence: number;
  };
}

export interface ProjectViewEnvelope
  extends EventEnvelope<ProjectViewEventKind, Record<string, unknown>> {
  version: typeof PROJECT_VIEW_VERSION;
  delivery: 'durable' | 'transient';
  agent?: IdentityRef<'agent'>;
  source?: ProjectViewEventInput['source'];
}

export type A2AProjectionChainStatus = 'active' | 'completed' | 'aborted' | 'timeout';

export type A2AProjectionPassStatus =
  | 'drafted'
  | 'validated'
  | 'offered'
  | 'accepted'
  | 'starting'
  | 'started'
  | 'completed'
  | 'blocked'
  | 'rejected'
  | 'timeout'
  | 'error';

export interface A2AProjectionHandoff {
  id: string;
  chainId: string;
  passId: string;
  fromAgentId: string;
  toAgentId: string;
  status: A2AProjectionPassStatus;
  intent: string;
  title?: string;
  reason?: string;
  phase?: string;
  timestamp: string;
}

export interface A2AProjectionSnapshot {
  conversationId: string;
  chainId: string;
  revision: number;
  currentHolderIds: string[];
  status: A2AProjectionChainStatus;
  updatedAt: string;
  handoffs: A2AProjectionHandoff[];
}

export function isProjectViewEnvelope(value: unknown): value is ProjectViewEnvelope {
  if (!isEventEnvelope(value)) return false;
  const envelope = value as Partial<ProjectViewEnvelope>;
  const actorType = envelope.actor?.type;
  return envelope.version === PROJECT_VIEW_VERSION
    && envelope.envelopeVersion === EVENT_ENVELOPE_VERSION
    && typeof envelope.type === 'string'
    && (actorType === 'user'
      || actorType === 'agent'
      || actorType === 'system'
      || actorType === 'runtime')
    && (envelope.agent === undefined
      || (isIdentityRef(envelope.agent) && envelope.agent.type === 'agent'))
    && typeof envelope.causationId === 'string'
    && envelope.causationId.trim().length > 0
    && (envelope.delivery === 'durable' || envelope.delivery === 'transient')
    && !!envelope.payload
    && typeof envelope.payload === 'object';
}
