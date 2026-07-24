import type Database from 'better-sqlite3';
import { PlatformEventLog } from './event-log';
import type { EventObjectRef, PlatformEvent } from './types';

export interface DomainEventPayloadMap {
  'task.assigned': { previousAgentId?: string; agentId: string; status: string };
  'task.in_progress': { previousStatus: string; status: string; agentId: string };
  'task.in_review': { previousStatus: string; status: string; agentId: string };
  'task.rejected': { previousStatus: string; status: string; agentId: string; reviewNote?: string };
  'task.done': { previousStatus: string; status: string; agentId: string };
  'task.blocked': { previousStatus: string; status: string; agentId: string; reviewNote?: string };
  'task.cancelled': { previousStatus: string; status: string; agentId: string };
  'task.reopened': { previousStatus: string; status: string; agentId: string };
  'review.submitted': { taskId: string; reviewerId?: string };
  'review.approved': { taskId: string; reviewerId?: string };
  'review.rejected': { taskId: string; reviewerId?: string; reason?: string };
  'review.merged': { taskId: string; reviewerId?: string };
  'delivery.run.submitted': { status: string; stage: string };
  'delivery.run.phase_advanced': { previousStatus: string; status: string; previousStage: string; stage: string };
  'delivery.run.completed': { previousStatus: string; status: string; stage: string };
  'delivery.run.escalated': { previousStatus: string; status: string; stage: string; code?: string };
  'delivery.run.cancelled': { previousStatus: string; status: string; stage: string };
  'delivery.action.claimed': { runId: string; attemptId: string; attemptNo: number };
  'delivery.action.succeeded': { runId: string; attemptId: string };
  'delivery.action.failed': { runId: string; attemptId: string; failureCode: string; retrying: boolean };
  'a2a.possession.passed': { chainId: string; fromAgentId: string; toAgentId: string; passId: string };
  'a2a.possession.completed': { chainId: string };
  'a2a.chain.entry_done': { chainId: string; outcome: string };
  'a2a.chain.completed': { status: string };
  'a2a.chain.aborted': { status: string; reason?: string };
  'envelope.validated': { status: string };
  'envelope.blocked': { previousStatus: string; status: string; reasonCode?: string };
  'envelope.queued': { status: string };
  'envelope.routed': { previousStatus: string; status: string };
  'envelope.sent': { previousStatus: string; status: string };
  'envelope.started': { previousStatus: string; status: string };
  'envelope.completed': { previousStatus: string; status: string };
  'envelope.failed': { previousStatus: string; status: string; reasonCode?: string };
  'envelope.expired': { previousStatus: string; status: string };
  'binding.started': { previousStatus: string; status: string; envelopeId: string };
  'binding.finished': { previousStatus: string; status: string };
  'binding.error': { previousStatus: string; status: string };
  'node.stale': { previousStatus: string; status: string; missedHeartbeats: number };
  'node.unreachable': { previousStatus: string; status: string; missedHeartbeats: number };
  'invocation.queued': { status: string; taskId?: string };
  'invocation.claimed': { previousStatus: string; status: string };
  'invocation.succeeded': { previousStatus: string; status: string };
  'invocation.failed': { previousStatus: string; status: string; reasonCode?: string };
  'session.sealed': { previousStatus: string; status: string; reason: string };
}

export type DomainEventType = keyof DomainEventPayloadMap;

export const DOMAIN_EVENT_TYPES_BY_OWNER = {
  task: [
    'task.assigned', 'task.in_progress', 'task.in_review', 'task.rejected',
    'task.done', 'task.blocked', 'task.cancelled', 'task.reopened',
  ],
  review: ['review.submitted', 'review.approved', 'review.rejected', 'review.merged'],
  delivery: [
    'delivery.run.submitted', 'delivery.run.phase_advanced', 'delivery.run.completed',
    'delivery.run.escalated', 'delivery.run.cancelled', 'delivery.action.claimed',
    'delivery.action.succeeded', 'delivery.action.failed',
  ],
  a2a: [
    'a2a.possession.passed', 'a2a.possession.completed', 'a2a.chain.entry_done',
    'a2a.chain.completed', 'a2a.chain.aborted',
  ],
  envelope: [
    'envelope.validated', 'envelope.blocked', 'envelope.queued', 'envelope.routed', 'envelope.sent',
    'envelope.started', 'envelope.completed', 'envelope.failed', 'envelope.expired',
  ],
  binding: ['binding.started', 'binding.finished', 'binding.error'],
  node: ['node.stale', 'node.unreachable'],
  invocation: ['invocation.queued', 'invocation.claimed', 'invocation.succeeded', 'invocation.failed'],
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
