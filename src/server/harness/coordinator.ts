import { proofLogRepo } from '../repositories/proof-log-repo';
import type {
  HarnessOutcome,
  HarnessPlanner,
  HarnessRuntimePort,
  HarnessSubmission,
  HarnessTrigger,
} from './types';

export interface HarnessCoordinatorOptions {
  planner: HarnessPlanner;
  runtime: HarnessRuntimePort;
  dedupeTtlMs?: number;
  now?: () => number;
  recordProof?: typeof proofLogRepo.append;
}
export class HarnessCoordinator {
  private readonly planner: HarnessPlanner;
  private readonly runtime: HarnessRuntimePort;
  private readonly dedupeTtlMs: number;
  private readonly now: () => number;
  private readonly recordProof: typeof proofLogRepo.append;
  private readonly acceptedAt = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<HarnessOutcome>>();
  private readonly completedOutcomes = new Map<string, HarnessOutcome>();

  constructor(options: HarnessCoordinatorOptions) {
    this.planner = options.planner;
    this.runtime = options.runtime;
    this.dedupeTtlMs = options.dedupeTtlMs ?? 2 * 60 * 1000;
    this.now = options.now ?? Date.now;
    this.recordProof = options.recordProof ?? proofLogRepo.append.bind(proofLogRepo);
  }

  submit(trigger: HarnessTrigger): HarnessSubmission {
    const key = trigger.idempotencyKey?.trim() || trigger.id;
    this.cleanupDedupe();

    const existing = this.inFlight.get(key);
    const completed = this.completedOutcomes.get(key);
    if (existing || completed) {
      const completion = existing ?? Promise.resolve(completed!);
      this.proof(trigger, 'harness.trigger.duplicate', 'duplicate_trigger');
      return {
        disposition: 'duplicate',
        handled: true,
        completion,
        duplicateInFlight: Boolean(existing),
      };
    }

    if (this.runtime.isBusy(trigger.agentId, trigger.conversationId)) {
      const outcome = { status: 'deferred', reasonCode: 'agent_busy' } as const;
      this.proof(trigger, 'harness.trigger.deferred', 'agent_busy');
      return {
        disposition: 'deferred',
        handled: false,
        completion: Promise.resolve(outcome),
      };
    }

    this.acceptedAt.set(key, this.now());
    this.proof(trigger, 'harness.trigger.accepted');
    const completion = this.run(trigger)
      .catch((error: unknown): HarnessOutcome => ({
        status: 'failed',
        reasonCode: 'internal_error',
        message: error instanceof Error ? error.message : String(error),
      }))
      .then((outcome) => {
        this.completedOutcomes.set(key, outcome);
        return outcome;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, completion);
    return { disposition: 'accepted', handled: true, completion };
  }

  private async run(trigger: HarnessTrigger): Promise<HarnessOutcome> {
    const resolution = await this.planner.prepare(trigger);
    if (!resolution.ok) {
      this.proof(trigger, 'harness.plan.blocked', resolution.outcome.reasonCode);
      return resolution.outcome;
    }

    this.proof(trigger, 'harness.plan.prepared', undefined, {
      runtimeId: resolution.plan.runtimeId,
      engine: resolution.plan.engine,
      hasSystemPrompt: Boolean(resolution.plan.systemPrompt),
    });
    const outcome = await this.runtime.execute(resolution.plan);
    this.proof(
      trigger,
      `harness.dispatch.${outcome.status}`,
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
    trigger: HarnessTrigger,
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
