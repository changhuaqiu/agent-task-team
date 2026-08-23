export const EVENT_ENVELOPE_VERSION = 1 as const;

export type IdentityKind =
  | 'user'
  | 'agent'
  | 'system'
  | 'runtime'
  | 'invocation'
  | 'invocation_attempt'
  | 'task'
  | 'delivery'
  | 'gate'
  | 'a2a_chain'
  | 'envelope'
  | 'session'
  | 'logical_session'
  | 'inbox_item'
  | 'message'
  | 'project'
  | 'project_agent'
  | 'quality_gate'
  | 'a2a_collaboration'
  | 'a2a_pass'
  | 'a2a_pass_group'
  | 'delivery_run'
  | 'delivery_receipt'
  | 'binding'
  | 'node'
  | 'agent_inbox'
  | 'agent_inbox_item'
  | 'agent_work'
  | 'control_action'
  | 'effect';

export interface ObjectRef<TKind extends string = string> {
  type: TKind;
  id: string;
}

export type IdentityRef<TKind extends string = IdentityKind> = ObjectRef<TKind>;

export interface EventEnvelope<
  TType extends string = string,
  TPayload = unknown,
  TActorKind extends IdentityKind = IdentityKind,
> {
  eventId: string;
  type: TType;
  envelopeVersion: typeof EVENT_ENVELOPE_VERSION;
  projectId: string;
  actor: IdentityRef<TActorKind>;
  subject?: ObjectRef;
  correlationId: string;
  causationId?: string;
  occurredAt: string;
  payload: TPayload;
}

export function isObjectRef(value: unknown): value is ObjectRef {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<IdentityRef>;
  return typeof candidate.type === 'string'
    && candidate.type.length > 0
    && typeof candidate.id === 'string'
    && candidate.id.trim().length > 0;
}

export const isIdentityRef = isObjectRef;

export function isEventEnvelope(value: unknown): value is EventEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<EventEnvelope>;
  return candidate.envelopeVersion === EVENT_ENVELOPE_VERSION
    && typeof candidate.eventId === 'string'
    && candidate.eventId.trim().length > 0
    && typeof candidate.type === 'string'
    && candidate.type.length > 0
    && typeof candidate.projectId === 'string'
    && candidate.projectId.trim().length > 0
    && isIdentityRef(candidate.actor)
    && (candidate.subject === undefined || isObjectRef(candidate.subject))
    && typeof candidate.correlationId === 'string'
    && candidate.correlationId.trim().length > 0
    && typeof candidate.occurredAt === 'string'
    && candidate.occurredAt.length > 0
    && candidate.payload !== undefined;
}
