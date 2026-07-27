import type {
  ControlAction,
  ControlDecision,
  SupervisorControlPolicy,
  SupervisorControlSnapshot,
} from './control-decision';
import { decideControlActions } from './control-decision';
import {
  ControlDecisionRepository,
  type PersistedControlActionRow,
} from './control-decision-repository';
import { RepositoryControlSnapshotBuilder } from './control-snapshot-builder';

export interface ControlCommandResult {
  status: 'applied' | 'rejected';
  reasonCode?: string;
}

export interface ControlCommandPort {
  execute(
    action: ControlAction,
    context: {
      decision: ControlDecision;
      snapshot: SupervisorControlSnapshot;
      claimToken: string;
    },
  ): Promise<ControlCommandResult>;
}

export interface DeliveryControlProcessManagerOptions {
  snapshots?: RepositoryControlSnapshotBuilder;
  decisions?: ControlDecisionRepository;
  commands: ControlCommandPort;
  workerId: string;
  leaseMs?: number;
  now?: () => Date;
}

export interface ControlReconcileResult {
  snapshot: SupervisorControlSnapshot;
  decision: ControlDecision;
  claimed: PersistedControlActionRow[];
}

/**
 * Orchestrates the Process Manager boundary without owning any downstream
 * domain state. It atomically claims the whole action set before issuing short
 * owner Commands, so the first emitted fact cannot stale sibling actions from
 * the same decision.
 */
export class DeliveryControlProcessManager {
  private readonly snapshots: RepositoryControlSnapshotBuilder;
  private readonly decisions: ControlDecisionRepository;
  private readonly leaseMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: DeliveryControlProcessManagerOptions) {
    this.snapshots = options.snapshots ?? new RepositoryControlSnapshotBuilder();
    this.decisions = options.decisions ?? new ControlDecisionRepository();
    this.leaseMs = options.leaseMs ?? 30_000;
    this.now = options.now ?? (() => new Date());
  }

  async reconcile(
    runId: string,
    projectId: string,
    policy: SupervisorControlPolicy,
  ): Promise<ControlReconcileResult> {
    const snapshot = this.snapshots.build(runId);
    const decision = decideControlActions(snapshot, policy);
    this.decisions.persist({ projectId, decision, now: this.now() });
    const claimed = this.decisions.claimDecision({
      decisionId: decision.decisionId,
      workerId: this.options.workerId,
      leaseMs: this.leaseMs,
      now: this.now(),
    });
    const actionById = new Map(decision.actions.map((action) => [action.actionId, action]));
    for (const claim of claimed) {
      const action = actionById.get(claim.id);
      if (!action || !claim.claim_token) {
        throw new Error(`Claimed ControlAction is missing from decision: ${claim.id}`);
      }
      try {
        const result = await this.options.commands.execute(action, {
          decision,
          snapshot,
          claimToken: claim.claim_token,
        });
        if (result.status === 'applied') {
          if (!this.decisions.complete({
            actionId: claim.id,
            claimToken: claim.claim_token,
            now: this.now(),
          })) throw new Error(`ControlAction completion lost claim: ${claim.id}`);
        } else {
          this.decisions.fail({
            actionId: claim.id,
            claimToken: claim.claim_token,
            reasonCode: result.reasonCode ?? 'control_command_rejected',
            now: this.now(),
          });
        }
      } catch (error) {
        this.decisions.fail({
          actionId: claim.id,
          claimToken: claim.claim_token,
          reasonCode: error instanceof Error ? error.message : 'control_command_failed',
          now: this.now(),
        });
      }
    }
    return { snapshot, decision, claimed };
  }
}
