import { autonomousDeliveryRepo, AutonomousDeliveryRepository } from './repository';
import { decideDeliveryNext, type ObservedDeliveryFacts } from './policy';
import type {
  ClaimedDeliveryAction,
  DeliveryActionReceipt,
  DeliveryFailureCode,
  DeliveryRunSnapshot,
  GoalContract,
} from './types';

export interface DeliveryFactsPort {
  observe(snapshot: DeliveryRunSnapshot): Promise<ObservedDeliveryFacts>;
}

export type DeliveryExecutionResult =
  | {
      status: 'succeeded';
      receipts?: DeliveryActionReceipt[];
    }
  | {
      status: 'deferred';
      reasonCode: 'agent_busy';
      detail?: string;
    }
  | {
      status: 'failed';
      failureCode: DeliveryFailureCode;
      detail?: string;
      retryable: boolean;
    };

export interface DeliveryActionPort {
  execute(claim: ClaimedDeliveryAction, snapshot: DeliveryRunSnapshot): Promise<DeliveryExecutionResult>;
}

export interface AdvancementCause {
  kind: 'started' | 'fact_changed' | 'periodic_reconcile' | 'manual_resume';
  ref?: string;
}

export interface AdvanceResult {
  disposition: 'acted' | 'waiting' | 'completed' | 'escalated' | 'busy';
  snapshot: DeliveryRunSnapshot;
  actionId?: string;
}

export interface AutonomousDeliverySupervisorOptions {
  repository?: AutonomousDeliveryRepository;
  facts: DeliveryFactsPort;
  actions: DeliveryActionPort;
  workerId: string;
  leaseMs?: number;
  maxActionsPerAdvance?: number;
  now?: () => Date;
}

function retryDelayMs(attemptCount: number): number {
  return Math.min(60_000, 1_000 * (2 ** Math.max(0, attemptCount - 1)));
}

export class AutonomousDeliverySupervisor {
  private readonly repository: AutonomousDeliveryRepository;
  private readonly facts: DeliveryFactsPort;
  private readonly actions: DeliveryActionPort;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly maxActionsPerAdvance: number;
  private readonly now: () => Date;

  constructor(options: AutonomousDeliverySupervisorOptions) {
    this.repository = options.repository ?? autonomousDeliveryRepo;
    this.facts = options.facts;
    this.actions = options.actions;
    this.workerId = options.workerId;
    this.leaseMs = options.leaseMs ?? 60_000;
    this.maxActionsPerAdvance = options.maxActionsPerAdvance ?? 16;
    this.now = options.now ?? (() => new Date());
  }

  start(contract: GoalContract): DeliveryRunSnapshot {
    this.validateContract(contract);
    return this.repository.createRun(contract, this.now());
  }

  get(runId: string): DeliveryRunSnapshot | undefined {
    return this.repository.getSnapshot(runId);
  }

  async advance(runId: string, cause?: AdvancementCause): Promise<AdvanceResult> {
    void cause;
    this.repository.abandonExpiredAttempts(this.now());
    let lastActionId: string | undefined;

    for (let index = 0; index < this.maxActionsPerAdvance; index += 1) {
      let snapshot = this.repository.getSnapshot(runId);
      if (!snapshot) throw new Error(`Delivery run not found: ${runId}`);
      if (snapshot.run.status === 'completed') {
        return { disposition: 'completed', snapshot, actionId: lastActionId };
      }
      if (snapshot.run.status === 'escalated' || snapshot.run.status === 'cancelled') {
        return { disposition: 'escalated', snapshot, actionId: lastActionId };
      }

      const facts = await this.facts.observe(snapshot);
      if (facts.bundle && !snapshot.bundle) {
        const updated = this.updateSnapshot(snapshot, {
          status: snapshot.run.status,
          stage: snapshot.run.current_stage,
          rootTaskId: facts.rootTaskId ?? snapshot.run.root_task_id ?? undefined,
          bundle: facts.bundle,
          now: this.now(),
        });
        if (!updated) return this.concurrentResult(runId, lastActionId);
        snapshot = updated;
      }
      const decision = decideDeliveryNext(snapshot, facts);
      if (decision.type === 'wait') {
        const updated = this.updateSnapshot(snapshot, {
          status: decision.status,
          stage: decision.stage,
          rootTaskId: decision.rootTaskId,
          now: this.now(),
        });
        if (!updated) return this.concurrentResult(runId, lastActionId);
        return {
          disposition: lastActionId ? 'acted' : 'waiting',
          snapshot: updated,
          actionId: lastActionId,
        };
      }
      if (decision.type === 'complete') {
        const updated = this.updateSnapshot(snapshot, {
          status: 'completed',
          stage: 'completed',
          rootTaskId: decision.rootTaskId,
          bundle: decision.bundle,
          now: this.now(),
        });
        if (!updated) return this.concurrentResult(runId, lastActionId);
        return {
          disposition: 'completed',
          snapshot: updated,
          actionId: lastActionId,
        };
      }
      if (decision.type === 'escalate') {
        const updated = this.updateSnapshot(snapshot, {
          status: 'escalated',
          stage: decision.stage,
          rootTaskId: decision.rootTaskId,
          escalationCode: decision.failureCode,
          escalationDetail: decision.detail,
          now: this.now(),
        });
        if (!updated) return this.concurrentResult(runId, lastActionId);
        return {
          disposition: 'escalated',
          snapshot: updated,
          actionId: lastActionId,
        };
      }

      const updatedForAction = this.updateSnapshot(snapshot, {
        status: decision.status,
        stage: decision.stage,
        rootTaskId: decision.rootTaskId,
        repairCycle: decision.repairCycle,
        now: this.now(),
      });
      if (!updatedForAction) return this.concurrentResult(runId, lastActionId);
      snapshot = updatedForAction;
      const action = this.repository.ensureAction({
        runId,
        kind: decision.action.kind,
        idempotencyKey: decision.action.idempotencyKey,
        maxAttempts: snapshot.contract.recoveryPolicy.maxAttemptsPerAction,
        subjectType: decision.action.subjectType,
        subjectId: decision.action.subjectId,
        now: this.now(),
      });
      if (action.status === 'succeeded') {
        // A successful idempotent action may already have changed the observed facts.
        continue;
      }
      if (action.status === 'claimed' || action.status === 'running') {
        return {
          disposition: lastActionId ? 'acted' : 'busy',
          snapshot: this.repository.getSnapshot(runId)!,
          actionId: lastActionId,
        };
      }
      if (action.status === 'failed') {
        const escalated = this.updateSnapshot(snapshot, {
          status: 'escalated',
          stage: decision.stage,
          rootTaskId: decision.rootTaskId,
          escalationCode: action.last_failure_code ?? 'unknown',
          escalationDetail: action.last_failure_detail ?? `动作 ${action.kind} 恢复次数已耗尽`,
          now: this.now(),
        });
        if (!escalated) return this.concurrentResult(runId, lastActionId);
        return {
          disposition: 'escalated',
          snapshot: escalated,
          actionId: lastActionId,
        };
      }

      const claim = this.repository.claimNext({
        runId,
        workerId: this.workerId,
        leaseMs: this.leaseMs,
        now: this.now(),
      });
      if (!claim) {
        return {
          disposition: lastActionId ? 'acted' : 'waiting',
          snapshot: this.repository.getSnapshot(runId)!,
          actionId: lastActionId,
        };
      }

      lastActionId = claim.action.id;
      this.repository.markAttemptRunning(claim.attempt.id, this.now());
      const { result, leaseLost } = await this.executeWithLeaseHeartbeat(
        claim,
        this.repository.getSnapshot(runId)!,
      );

      if (result.status === 'succeeded') {
        const completed = !leaseLost && this.repository.completeAttempt({
          runId,
          actionId: claim.action.id,
          attemptId: claim.attempt.id,
          receipts: result.receipts,
          now: this.now(),
        });
        if (!completed) {
          return {
            disposition: 'busy',
            snapshot: this.repository.getSnapshot(runId)!,
            actionId: lastActionId,
          };
        }
        continue;
      }

      if (result.status === 'deferred') {
        const deferred = !leaseLost && this.repository.deferAttempt({
          actionId: claim.action.id,
          attemptId: claim.attempt.id,
          reasonCode: result.reasonCode,
          detail: result.detail,
          retryAt: new Date(this.now().getTime() + retryDelayMs(claim.action.attempt_count)),
          now: this.now(),
        });
        if (!deferred) {
          return {
            disposition: 'busy',
            snapshot: this.repository.getSnapshot(runId)!,
            actionId: lastActionId,
          };
        }
        return {
          disposition: 'waiting',
          snapshot: this.repository.getSnapshot(runId)!,
          actionId: lastActionId,
        };
      }

      const retryAt = result.retryable
        ? new Date(this.now().getTime() + retryDelayMs(claim.action.attempt_count))
        : undefined;
      const actionStatus = this.repository.failAttempt({
        actionId: claim.action.id,
        attemptId: claim.attempt.id,
        failureCode: result.failureCode,
        failureDetail: result.detail,
        retryAt,
        now: this.now(),
      });
      if (actionStatus === 'stale') {
        return {
          disposition: 'busy',
          snapshot: this.repository.getSnapshot(runId)!,
          actionId: lastActionId,
        };
      }
      if (actionStatus === 'retry_wait') {
        const current = this.repository.getSnapshot(runId)!;
        const recovering = this.updateSnapshot(current, {
          status: 'recovering',
          stage: decision.stage,
          rootTaskId: decision.rootTaskId,
          now: this.now(),
        });
        if (!recovering) return this.concurrentResult(runId, lastActionId);
        return {
          disposition: 'acted',
          snapshot: recovering,
          actionId: lastActionId,
        };
      }

      const current = this.repository.getSnapshot(runId)!;
      const escalated = this.updateSnapshot(current, {
        status: 'escalated',
        stage: decision.stage,
        rootTaskId: decision.rootTaskId,
        escalationCode: result.failureCode,
        escalationDetail: result.detail ?? `动作 ${claim.action.kind} 执行失败`,
        now: this.now(),
      });
      if (!escalated) return this.concurrentResult(runId, lastActionId);
      return {
        disposition: 'escalated',
        snapshot: escalated,
        actionId: lastActionId,
      };
    }

    return {
      disposition: lastActionId ? 'acted' : 'waiting',
      snapshot: this.repository.getSnapshot(runId)!,
      actionId: lastActionId,
    };
  }

  private updateSnapshot(
    snapshot: DeliveryRunSnapshot,
    patch: Omit<
      Parameters<AutonomousDeliveryRepository['updateRun']>[0],
      'runId' | 'expectedRevision'
    >,
  ): DeliveryRunSnapshot | undefined {
    const updated = this.repository.updateRun({
      ...patch,
      runId: snapshot.run.id,
      expectedRevision: snapshot.run.revision,
    });
    return updated ? this.repository.getSnapshot(snapshot.run.id) : undefined;
  }

  private concurrentResult(runId: string, actionId?: string): AdvanceResult {
    const snapshot = this.repository.getSnapshot(runId);
    if (!snapshot) throw new Error(`Delivery run not found: ${runId}`);
    if (snapshot.run.status === 'completed') {
      return { disposition: 'completed', snapshot, actionId };
    }
    if (snapshot.run.status === 'escalated' || snapshot.run.status === 'cancelled') {
      return { disposition: 'escalated', snapshot, actionId };
    }
    return { disposition: 'busy', snapshot, actionId };
  }

  private async executeWithLeaseHeartbeat(
    claim: ClaimedDeliveryAction,
    snapshot: DeliveryRunSnapshot,
  ): Promise<{ result: DeliveryExecutionResult; leaseLost: boolean }> {
    let leaseLost = false;
    const heartbeatIntervalMs = Math.max(1, Math.floor(this.leaseMs / 3));
    const heartbeat = setInterval(() => {
      try {
        if (!this.repository.heartbeat(claim.attempt.id, this.leaseMs, this.now())) {
          leaseLost = true;
        }
      } catch {
        leaseLost = true;
      }
    }, heartbeatIntervalMs);
    heartbeat.unref?.();

    try {
      return {
        result: await this.actions.execute(claim, snapshot),
        leaseLost,
      };
    } catch (error) {
      return {
        result: {
          status: 'failed',
          failureCode: 'unknown',
          detail: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
        leaseLost,
      };
    } finally {
      clearInterval(heartbeat);
    }
  }

  private validateContract(contract: GoalContract): void {
    if (!contract.goal.trim()) throw new Error('交付目标不能为空');
    if (!contract.scope.conversationId.trim()) throw new Error('conversationId 不能为空');
    if (contract.acceptanceCriteria.length === 0) throw new Error('至少需要一条验收标准');
    if (
      contract.deliveryPolicy.requireWebE2E
      && !contract.scope.projectPath?.trim()
    ) {
      throw new Error('Web UI 端到端验收需要项目目录');
    }
    if (contract.recoveryPolicy.maxAttemptsPerAction < 1) {
      throw new Error('maxAttemptsPerAction 必须大于 0');
    }
    if (contract.recoveryPolicy.maxRepairCycles < 0) {
      throw new Error('maxRepairCycles 不能小于 0');
    }
    if (contract.deliveryPolicy.requireMerge && !contract.authorization.allowAutoMerge) {
      // This is accepted as a valid contract: the run can proceed up to the merge authorization gate.
      return;
    }
  }
}
