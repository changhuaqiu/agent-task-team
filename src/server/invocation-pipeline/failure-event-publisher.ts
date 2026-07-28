// Invocation Pipeline failure normalization.
import { PlatformEventLog } from '../platform-events/event-log';
import { RuntimeEventPublisher } from '../platform-events/runtime-event-publisher';
import type { AgentActivationCommand, InvocationDispatchOutcome } from './types';

type InvocationFailure = Extract<InvocationDispatchOutcome, { status: 'blocked' | 'failed' }>;

export interface InvocationFailureEventPublisherOptions {
  eventLog?: PlatformEventLog;
  runtimeActorId?: string;
}

/**
 * Normalizes Invocation preflight failures at the boundary where they become
 * authoritative. Proof logs remain diagnostic evidence; these events are the
 * facts consumed by Process Managers.
 */
export class InvocationFailureEventPublisher {
  private readonly eventLog: PlatformEventLog;
  private readonly runtimeActorId: string;

  constructor(options: InvocationFailureEventPublisherOptions = {}) {
    this.eventLog = options.eventLog ?? new PlatformEventLog();
    this.runtimeActorId = options.runtimeActorId ?? 'invocation-preflight';
  }

  publish(trigger: AgentActivationCommand, outcome: InvocationFailure): void {
    const attemptId = trigger.id;
    const correlationId = outcome.evidence?.traceId
      ?? trigger.correlationId?.trim()
      ?? trigger.idempotencyKey?.trim()
      ?? trigger.id;

    if (outcome.reasonCode === 'runtime_profile_missing') {
      new RuntimeEventPublisher(this.eventLog, {
        projectId: trigger.conversationId,
        projectAgentId: trigger.agentId,
        invocationId: attemptId,
        runtimeActorId: this.runtimeActorId,
        correlationId,
        causationId: trigger.causationId,
      }).publish('runtime.invocation.blocked', {
        phase: 'preflight',
        reasonCode: outcome.reasonCode,
        workId: trigger.workId,
        deliveryRunId: trigger.deliveryRunId,
        message: outcome.message,
      });
      return;
    }

    if (outcome.reasonCode === 'required_context_missing') {
      const snapshotId = outcome.evidence?.snapshotId ?? `rejected:${attemptId}`;
      this.eventLog.append({
        type: 'context.snapshot.rejected',
        category: 'coordination',
        projectId: trigger.conversationId,
        streamKey: `context_snapshot:${snapshotId}`,
        aggregate: { type: 'context_snapshot', id: snapshotId },
        actor: { type: 'system', id: 'context-manager' },
        subject: { type: 'invocation_attempt', id: attemptId },
        projectAgentId: trigger.agentId,
        correlationId,
        dedupeKey: `context:${snapshotId}:rejected`,
        payload: {
          reasonCode: outcome.reasonCode,
          workId: trigger.workId,
          deliveryRunId: trigger.deliveryRunId,
          missingRequired: outcome.evidence?.missingRequired ?? [],
          message: outcome.message,
        },
      });
    }
  }
}
