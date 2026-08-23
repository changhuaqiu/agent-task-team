// Invocation Pipeline admission and execution coordination.
import { proofLogRepo } from '../repositories/proof-log-repo';
import type {
  AgentActivationCommand,
  InvocationDispatchOutcome,
  InvocationPlannerPort,
  InvocationSubmitOptions,
  InvocationSubmission,
} from './types';
import type { AgentRuntime } from '../agent-runtime';
import type { InvocationFailureEventPublisher } from './failure-event-publisher';

export interface InvocationCoordinatorOptions {
  planner: InvocationPlannerPort;
  runtime: AgentRuntime;
  dedupeTtlMs?: number;
  now?: () => number;
  recordProof?: typeof proofLogRepo.append;
  failureEvents?: Pick<InvocationFailureEventPublisher, 'publish'>;
}
export class InvocationCoordinator {
  private readonly planner: InvocationPlannerPort;
  private readonly runtime: AgentRuntime;
  private readonly dedupeTtlMs: number;
  private readonly now: () => number;
  private readonly recordProof: typeof proofLogRepo.append;
  private readonly acceptedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<InvocationDispatchOutcome>>();
  private readonly inFlightStarts = new Map<string, Promise<InvocationDispatchOutcome>>();
  private readonly completedOutcomes = new Map<string, InvocationDispatchOutcome>();
  private readonly failureEvents?: Pick<InvocationFailureEventPublisher, 'publish'>;

  constructor(options: InvocationCoordinatorOptions) {
    this.planner = options.planner;
    this.runtime = options.runtime;
    this.dedupeTtlMs = options.dedupeTtlMs ?? 2 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.recordProof = options.recordProof ?? proofLogRepo.append.bind(proofLogRepo);
    this.failureEvents = options.failureEvents;
  }

  submit(trigger: AgentActivationCommand, options: InvocationSubmitOptions = {}): InvocationSubmission {
    const localKey = trigger.idempotencyKey?.trim() || trigger.id;
    const key = `${trigger.conversationId}:${trigger.agentId}:${localKey}`;
    this.cleanupDedupe();

    const existing = this.inFlight.get(key);
    const completed = this.completedOutcomes.get(key);
    if (existing || completed) {
      const completion = existing ?? Promise.resolve(completed!);
      const started = this.inFlightStarts.get(key) ?? completion;
      this.proof(trigger, 'invocation.activation.duplicate', 'duplicate_trigger');
      return {
        disposition: 'duplicate',
        handled: true,
        started,
        completion,
        duplicateInFlight: Boolean(existing),
      };
    }

    if (this.runtime.isBusy(trigger.agentId, trigger.conversationId)) {
      const outcome = { status: 'deferred', reasonCode: 'agent_busy' } as const;
      this.proof(trigger, 'invocation.activation.deferred', 'agent_busy');
      return {
        disposition: 'deferred',
        handled: false,
        started: Promise.resolve(outcome),
        completion: Promise.resolve(outcome),
      };
    }

    this.acceptedAt.set(key, this.now());
    this.proof(trigger, 'invocation.activation.accepted');
    let startSettled = false;
    let resolveStarted!: (outcome: InvocationDispatchOutcome) => void;
    const started = new Promise<InvocationDispatchOutcome>((resolve) => {
      resolveStarted = resolve;
    });
    const settleStarted = (outcome: InvocationDispatchOutcome) => {
      if (startSettled) return;
      startSettled = true;
      resolveStarted(outcome);
    };
    const completion = this.run(trigger, settleStarted, options)
      .catch((error: unknown): InvocationDispatchOutcome => ({
        status: 'failed',
        reasonCode: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        settleStarted(outcome);
        // Startup failure is retriable work, not a completed dedupe receipt.
        if (
          outcome.status !== 'deferred'
          && !('reasonCode' in outcome && outcome.reasonCode === 'runtime_start_failed')
        ) {
          this.completedOutcomes.set(key, outcome);
        }
        return outcome;
      })
      .finally(() => {
        this.inFlight.delete(key);
        this.inFlightStarts.delete(key);
      });
    this.inFlight.set(key, completion);
    this.inFlightStarts.set(key, started);
    return { disposition: 'accepted', handled: true, started, completion };
  }

  private async run(
    trigger: AgentActivationCommand,
    onStarted: (outcome: InvocationDispatchOutcome) => void,
    options: InvocationSubmitOptions,
  ): Promise<InvocationDispatchOutcome> {
    const resolution = await this.planner.prepare(trigger);
    if (!resolution.ok) {
      this.proof(trigger, 'invocation.plan.blocked', resolution.outcome.reasonCode);
      this.failureEvents?.publish(trigger, resolution.outcome);
      return resolution.outcome;
    }

    this.proof(trigger, 'invocation.plan.prepared', undefined, {
      runtimeId: resolution.plan.runtimeId,
      engine: resolution.plan.engine,
      hasSystemPrompt: Boolean(resolution.plan.systemPrompt),
    });
    const outcome = await this.runtime.execute(resolution.plan, {
      onAcknowledged: (envelopeId) => onStarted({ status: 'accepted', envelopeId }),
      signal: options.signal,
      canAcknowledge: options.canAcknowledge,
      commitRuntimeStart: options.commitRuntimeStart,
    });
    this.proof(
      trigger,
      `invocation.dispatch.${outcome.status}`,
      'reasonCode' in outcome ? outcome.reasonCode : undefined,
    );
    return outcome;
  }

  private cleanupDedupe(): void {
    const now = this.now();
    for (const [key, timestamp] of this.acceptedAt) {
      if (now - timestamp > this.dedupeTtlMs && !this.inFlight.has(key)) {
        this.acceptedAt.delete(key);
        this.completedOutcomes.delete(key);
      }
    }
  }

  private proof(
    trigger: AgentActivationCommand,
    eventType: string,
    reasonCode?: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.recordProof({
      eventType,
      conversationId: trigger.conversationId,
      taskId: trigger.taskId,
      chainId: trigger.chainId,
      passId: trigger.passId,
      agentId: trigger.agentId,
      actorId: trigger.fromAgentId ?? trigger.source,
      reasonCode,
      metadata: {
        triggerId: trigger.id,
        source: trigger.source,
        idempotencyKey: trigger.idempotencyKey,
        ...metadata,
      },
    });
  }
}
