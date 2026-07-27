import type Database from 'better-sqlite3';
import { PlatformEventLog } from './event-log';
import type { EventObjectRef, PlatformEvent } from './types';

export interface DomainEventPayloadMap {
  'task.assigned': { previousAgentId?: string; agentId: string; status: string };
  'task.ready': { previousStatus: string; status: string; agentId: string };
  'task.in_progress': { previousStatus: string; status: string; agentId: string };
  'task.in_review': { previousStatus: string; status: string; agentId: string };
  'task.changes_requested': { previousStatus: string; status: string; agentId: string; reviewNote?: string };
  'task.done': { previousStatus: string; status: string; agentId: string };
  'task.blocked': { previousStatus: string; status: string; agentId: string; reviewNote?: string };
  'task.cancelled': { previousStatus: string; status: string; agentId: string };
  'gate.requested': {
    kind: string;
    targetType: string;
    targetId: string;
    artifactRevision: string;
    status: string;
  };
  'gate.evidence_submitted': { gateId: string; evidenceId: string; evidenceType: string };
  'gate.evaluating': { gateId: string; evaluatorId: string };
  'gate.passed': {
    gateId: string;
    kind: string;
    targetId: string;
    artifactRevision: string;
    evaluatorId: string;
    evidenceIds: string[];
    reason?: string;
  };
  'gate.changes_requested': {
    gateId: string;
    kind: string;
    targetId: string;
    artifactRevision: string;
    evaluatorId: string;
    evidenceIds: string[];
    reason?: string;
  };
  'gate.rejected': {
    gateId: string;
    kind: string;
    targetId: string;
    artifactRevision: string;
    evaluatorId: string;
    evidenceIds: string[];
    reason?: string;
  };
  'gate.cancelled': { gateId: string; actorId: string; reason: string };
  'delivery.run.started': { status: string; stage: string };
  'delivery.run.state_changed': { previousStatus: string; status: string; previousStage: string; stage: string };
  'delivery.run.completed': { previousStatus: string; status: string; stage: string };
  'delivery.run.waiting_human': { previousStatus: string; status: string; stage: string; code?: string };
  'delivery.run.failed': { previousStatus: string; status: string; stage: string };
  'delivery.run.cancelled': { previousStatus: string; status: string; stage: string };
  'delivery.action.claimed': { runId: string; attemptId: string; attemptNo: number };
  'delivery.action.succeeded': { runId: string; attemptId: string };
  'delivery.action.failed': { runId: string; attemptId: string; failureCode: string; retrying: boolean };
  'a2a.possession.passed': { chainId: string; fromAgentId: string; toAgentId: string; passId: string };
  'a2a.possession.completed': { chainId: string };
  'a2a.chain.entry_done': { chainId: string; outcome: string };
  'a2a.chain.completed': { status: string };
  'a2a.chain.aborted': { status: string; reason?: string };
  'envelope.drafted': { status: string };
  'envelope.validated': { previousStatus: string; status: string };
  'envelope.routed': { previousStatus: string; status: string };
  'envelope.sent': { previousStatus: string; status: string };
  'envelope.acknowledged': { previousStatus: string; status: string };
  'envelope.rejected': { previousStatus: string; status: string; reasonCode: string };
  'envelope.expired': { previousStatus: string; status: string };
  'binding.started': { previousStatus: string; status: string; envelopeId: string };
  'binding.finished': { previousStatus: string; status: string };
  'binding.error': { previousStatus: string; status: string };
  'node.stale': { previousStatus: string; status: string; missedHeartbeats: number };
  'node.unreachable': { previousStatus: string; status: string; missedHeartbeats: number };
  'invocation.planned': { status: string; taskId?: string };
  'invocation.starting': { previousStatus: string; status: string };
  'invocation.running': { previousStatus: string; status: string };
  'invocation.terminating': { previousStatus: string; status: string };
  'invocation.terminated': {
    previousStatus: string;
    status: string;
    outcome: string;
    reasonCode?: string;
  };
  'session.sealed': { previousStatus: string; status: string; reason: string };
}

export type DomainEventType = keyof DomainEventPayloadMap;

export const DOMAIN_EVENT_TYPES_BY_OWNER = {
  task: [
    'task.assigned', 'task.ready', 'task.in_progress', 'task.in_review',
    'task.changes_requested', 'task.done', 'task.blocked', 'task.cancelled',
  ],
  gate: [
    'gate.requested', 'gate.evidence_submitted', 'gate.evaluating', 'gate.passed',
    'gate.changes_requested', 'gate.rejected', 'gate.cancelled',
  ],
  delivery: [
    'delivery.run.started', 'delivery.run.state_changed', 'delivery.run.completed',
    'delivery.run.waiting_human', 'delivery.run.failed', 'delivery.run.cancelled',
    'delivery.action.claimed',
    'delivery.action.succeeded', 'delivery.action.failed',
  ],
  a2a: [
    'a2a.possession.passed', 'a2a.possession.completed', 'a2a.chain.entry_done',
    'a2a.chain.completed', 'a2a.chain.aborted',
  ],
  envelope: [
    'envelope.drafted', 'envelope.validated', 'envelope.routed', 'envelope.sent',
    'envelope.acknowledged', 'envelope.rejected', 'envelope.expired',
  ],
  binding: ['binding.started', 'binding.finished', 'binding.error'],
  node: ['node.stale', 'node.unreachable'],
  invocation: [
    'invocation.planned', 'invocation.starting', 'invocation.running',
    'invocation.terminating', 'invocation.terminated',
  ],
  session: ['session.sealed'],
} as const satisfies Record<string, readonly DomainEventType[]>;

export interface PublishDomainEventInput<TType extends DomainEventType> {
  type: TType;
  projectId: string;
  aggregate: EventObjectRef & { version?: number };
  actor?: EventObjectRef & { type: 'user' | 'agent' | 'system' };
  subject?: EventObjectRef;
  projectAgentId?: string;
  correlationId?: string;
  causationId?: string;
  dedupeKey?: string;
  occurredAt?: string;
  streamKey?: string;
  payload: DomainEventPayloadMap[TType];
}

export class DomainEventPublisher {
  private readonly log: PlatformEventLog;

  constructor(db?: Database.Database) {
    this.log = new PlatformEventLog({ db });
  }

  publish<TType extends DomainEventType>(
    input: PublishDomainEventInput<TType>,
  ): PlatformEvent<TType, DomainEventPayloadMap[TType]> {
    return this.log.append({
      type: input.type,
      category: 'domain',
      projectId: input.projectId,
      streamKey: input.streamKey ?? `${input.aggregate.type}:${input.aggregate.id}`,
      aggregate: input.aggregate,
      actor: input.actor ?? { type: 'system', id: `${input.aggregate.type}-domain` },
      subject: input.subject,
      projectAgentId: input.projectAgentId,
      correlationId: input.correlationId ?? input.aggregate.id,
      causationId: input.causationId,
      dedupeKey: input.dedupeKey,
      occurredAt: input.occurredAt,
      payload: input.payload,
    }) as PlatformEvent<TType, DomainEventPayloadMap[TType]>;
  }
}
