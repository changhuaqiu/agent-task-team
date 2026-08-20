import type { DeliveryControlPolicy } from './control-decision';
import { getDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { ProductionControlCommandAdapter } from './control-command-adapter';
import { DeliveryControlProcessManager } from './control-process-manager';
import {
  AutonomousDeliveryRepository,
  autonomousDeliveryRepo,
} from './repository';
import type {
  AdvanceResult,
  AdvancementCause,
  DeliveryRunSnapshot,
  GoalContract,
} from './types';

export interface AutonomousDeliveryRuntimePort {
  start(contract: GoalContract): DeliveryRunSnapshot;
  get(runId: string): DeliveryRunSnapshot | undefined;
  advance(runId: string, cause?: AdvancementCause): Promise<AdvanceResult>;
}

interface DeliveryControlRuntimeOptions {
  repository?: AutonomousDeliveryRepository;
  processManager?: DeliveryControlProcessManager;
  workerId: string;
  policy?: DeliveryControlPolicy;
  maxReconcilesPerAdvance?: number;
  now?: () => Date;
}

const DEFAULT_POLICY: DeliveryControlPolicy = {
  revision: 8,
  maxConcurrent: 4,
  roleCapacity: {},
  fairnessAgingMs: 60_000,
};

export class DeliveryControlRuntime implements AutonomousDeliveryRuntimePort {
  private readonly repository: AutonomousDeliveryRepository;
  private readonly processManager: DeliveryControlProcessManager;
  private readonly policy: DeliveryControlPolicy;
  private readonly maxReconciles: number;
  private readonly now: () => Date;

  constructor(options: DeliveryControlRuntimeOptions) {
    this.repository = options.repository ?? autonomousDeliveryRepo;
    this.now = options.now ?? (() => new Date());
    this.processManager = options.processManager ?? new DeliveryControlProcessManager({
      commands: new ProductionControlCommandAdapter({
        deliveries: this.repository,
        now: this.now,
      }),
      workerId: options.workerId,
      now: this.now,
    });
    this.policy = options.policy ?? DEFAULT_POLICY;
    this.maxReconciles = options.maxReconcilesPerAdvance ?? 16;
  }

  start(contract: GoalContract): DeliveryRunSnapshot {
    this.validateContract(contract);
    return this.repository.createRun(contract, this.now());
  }

  get(runId: string): DeliveryRunSnapshot | undefined {
    return this.repository.getSnapshot(runId);
  }

  async advance(runId: string, cause?: AdvancementCause): Promise<AdvanceResult> {
    let snapshot = this.requiredSnapshot(runId);
    if (cause?.kind === 'manual_resume') {
      const idempotencyKey = cause.idempotencyKey.trim();
      const actorId = cause.actor.id.trim();
      if (!idempotencyKey) throw new Error('manual_resume_idempotency_key_required');
      if (!actorId) throw new Error('manual_resume_actor_required');
      const receiptKey = `${runId}:manual-resume:${idempotencyKey}`;
      const receipt = {
        kind: 'human.manual_resume',
        status: 'accepted',
        externalId: actorId,
        payload: { actor: { type: 'user', id: actorId } },
        idempotencyKey: receiptKey,
      };
      if (this.repository.getReceiptByIdempotencyKey(receiptKey)) {
        this.repository.recordReceipt({ runId, receipt });
        return this.replayedManualResumeResult(this.requiredSnapshot(runId));
      }
      if (snapshot.run.status !== 'waiting_human') {
        throw new Error(`manual_resume_requires_waiting_human:${runId}`);
      }
      const correlationId = cause.correlationId ?? snapshot.contract.correlationId ?? runId;
      const resumed = getDb().transaction(() => {
        this.repository.recordReceipt({
          runId,
          receipt,
          actor: cause.actor,
          correlationId,
          now: this.now(),
        });
        const receiptEvent = new PlatformEventLog().getByDedupeKey(
          `delivery-receipt:${receiptKey}`,
        );
        if (!receiptEvent) throw new Error('manual_resume_receipt_event_missing');
        return this.repository.transitionRun({
          runId,
          to: 'active',
          stage: snapshot.run.current_stage,
          expectedRevision: snapshot.run.revision,
          actor: cause.actor,
          correlationId,
          causationId: receiptEvent.eventId,
          eventIdempotencyKey: `delivery-manual-resume:${receiptKey}`,
          now: this.now(),
        });
      }).immediate();
      if (!resumed) return { disposition: 'busy', snapshot: this.requiredSnapshot(runId) };
      snapshot = this.requiredSnapshot(runId);
    }
    if (snapshot.run.status === 'waiting_human') {
      return { disposition: 'waiting_human', snapshot };
    }

    let lastActionId: string | undefined;
    for (let index = 0; index < this.maxReconciles; index += 1) {
      snapshot = this.requiredSnapshot(runId);
      const terminal = this.terminalResult(snapshot, lastActionId);
      if (terminal) return terminal;
      const reconciled = await this.processManager.reconcile(
        runId,
        snapshot.run.conversation_id,
        this.policy,
      );
      if (reconciled.claimed.length === 0) {
        snapshot = this.requiredSnapshot(runId);
        return {
          disposition: snapshot.run.status === 'waiting_human'
            ? 'waiting_human'
            : lastActionId
              ? 'acted'
              : 'waiting',
          snapshot,
          ...(lastActionId ? { actionId: lastActionId } : {}),
        };
      }
      lastActionId = reconciled.claimed.at(-1)?.id;
    }
    snapshot = this.requiredSnapshot(runId);
    return {
      disposition: lastActionId ? 'acted' : 'waiting',
      snapshot,
      ...(lastActionId ? { actionId: lastActionId } : {}),
    };
  }

  private requiredSnapshot(runId: string): DeliveryRunSnapshot {
    const snapshot = this.repository.getSnapshot(runId);
    if (!snapshot) throw new Error(`Delivery run not found: ${runId}`);
    return snapshot;
  }

  private terminalResult(
    snapshot: DeliveryRunSnapshot,
    actionId?: string,
  ): AdvanceResult | undefined {
    if (snapshot.run.status === 'completed') {
      return { disposition: 'completed', snapshot, ...(actionId ? { actionId } : {}) };
    }
    if (snapshot.run.status === 'failed' || snapshot.run.status === 'cancelled') {
      return { disposition: 'failed', snapshot, ...(actionId ? { actionId } : {}) };
    }
    if (snapshot.run.status === 'waiting_human') {
      return { disposition: 'waiting_human', snapshot, ...(actionId ? { actionId } : {}) };
    }
    return undefined;
  }

  private replayedManualResumeResult(snapshot: DeliveryRunSnapshot): AdvanceResult {
    return this.terminalResult(snapshot)
      ?? {
        disposition: snapshot.run.status === 'waiting_human' ? 'waiting_human' : 'waiting',
        snapshot,
      };
  }

  private validateContract(contract: GoalContract): void {
    if (!contract.goal.trim()) throw new Error('delivery_goal_required');
    if (!contract.scope.conversationId.trim()) throw new Error('delivery_conversation_required');
    if (contract.acceptanceCriteria.length === 0) {
      throw new Error('delivery_acceptance_criteria_required');
    }
    if (contract.deliveryPolicy.requireWebE2E && !contract.scope.projectPath?.trim()) {
      throw new Error('delivery_web_e2e_project_path_required');
    }
    if (contract.recoveryPolicy.maxAttemptsPerAction < 1) {
      throw new Error('delivery_attempt_budget_invalid');
    }
    if (contract.recoveryPolicy.maxRepairCycles < 0) {
      throw new Error('delivery_repair_budget_invalid');
    }
  }
}
