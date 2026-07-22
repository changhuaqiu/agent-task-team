import type { Server as IOServer } from 'socket.io';
import {
  HarnessDeliveryActionAdapter,
  RepositoryDeliveryFactsAdapter,
} from './production-adapters';
import { autonomousDeliveryRepo } from './repository';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import {
  getAutonomousDeliverySupervisor,
  registerAutonomousDeliverySupervisor,
} from './registry';
import { AutonomousDeliverySupervisor } from './supervisor';
import { GitHubProviderActionAdapter } from './provider-actions';

const RECONCILE_TIMER_KEY = Symbol.for('agent-task-hub.autonomous-delivery.reconcile-timer');
const RECONCILE_HOOKS_KEY = Symbol.for('agent-task-hub.autonomous-delivery.reconcile-hooks');
const RECOVERY_HOOKS_KEY = Symbol.for('agent-task-hub.autonomous-delivery.recovery-hooks');
const STARTED_WORKERS_KEY = Symbol.for('agent-task-hub.autonomous-delivery.started-workers');
const PENDING_RESTART_NODES_KEY = Symbol.for('agent-task-hub.autonomous-delivery.pending-restart-nodes');
const RECONCILE_CHAIN_KEY = Symbol.for('agent-task-hub.autonomous-delivery.reconcile-chain');

type ReconcileReason = 'startup' | 'periodic';

interface RuntimeOptions {
  beforeReconcile?: (reason: ReconcileReason) => void | Promise<void>;
  afterEnvelopeRecovery?: (reason: ReconcileReason) => void | Promise<void>;
}

export async function runBeforeReconcileHooks(
  hooks: Iterable<NonNullable<RuntimeOptions['beforeReconcile']>>,
  reason: ReconcileReason,
): Promise<boolean> {
  for (const hook of hooks) {
    try {
      await hook(reason);
    } catch (error) {
      console.error(`[autonomous-delivery] ${reason} pre-reconcile hook failed:`, error);
      return false;
    }
  }
  return true;
}

function deliveryLeaseMs(): number {
  const configured = Number(process.env.AUTONOMOUS_DELIVERY_LEASE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

export async function reconcileActiveRuns(
  supervisor: AutonomousDeliverySupervisor,
  reason: ReconcileReason,
  restartedNodeIds?: string | string[],
  afterEnvelopeRecovery?: () => void | Promise<void>,
): Promise<boolean> {
  try {
    // A new daemon process cannot own a dispatch that the previous process
    // recorded as started. Its node remains in the persisted retry set until
    // the transactional recovery succeeds. TTL expiry itself is limited to
    // pre-start states so a legitimate long-running agent is never duplicated.
    const nodes = typeof restartedNodeIds === 'string' ? [restartedNodeIds] : restartedNodeIds ?? [];
    for (const restartedNodeId of nodes) {
      executionEnvelopeRepo.expireStartedAfterRestart(
        restartedNodeId,
        process.env.ATH_TMUX_ENABLED !== '1',
      );
    }
    executionEnvelopeRepo.expireStalePending();
  } catch (error) {
    console.error(`[autonomous-delivery] ${reason} envelope expiry failed:`, error);
    return false;
  }
  await afterEnvelopeRecovery?.();
  for (const run of autonomousDeliveryRepo.listActive()) {
    try {
      await supervisor.advance(run.id, { kind: 'periodic_reconcile', ref: reason });
    } catch (error) {
      console.error(`[autonomous-delivery] ${reason} reconcile failed for ${run.id}:`, error);
    }
  }
  return true;
}

export function ensureAutonomousDeliveryRuntime(
  io: IOServer,
  workerId = 'server:autonomous-delivery',
  options: RuntimeOptions = {},
): AutonomousDeliverySupervisor {
  const existing = getAutonomousDeliverySupervisor(io);
  const supervisor = existing ?? (() => {
    const provider = new GitHubProviderActionAdapter();
    const created = new AutonomousDeliverySupervisor({
      facts: new RepositoryDeliveryFactsAdapter(provider),
      actions: new HarnessDeliveryActionAdapter(io, provider),
      workerId,
      leaseMs: deliveryLeaseMs(),
    });
    registerAutonomousDeliverySupervisor(io, created);
    return created;
  })();

  const shared = io as unknown as Record<symbol, unknown>;
  const pendingRestartNodes = (shared[PENDING_RESTART_NODES_KEY] as Set<string> | undefined)
    ?? new Set<string>();
  shared[PENDING_RESTART_NODES_KEY] = pendingRestartNodes;
  const hooks = (shared[RECONCILE_HOOKS_KEY] as Set<NonNullable<RuntimeOptions['beforeReconcile']>> | undefined)
    ?? new Set<NonNullable<RuntimeOptions['beforeReconcile']>>();
  shared[RECONCILE_HOOKS_KEY] = hooks;
  if (options.beforeReconcile) hooks.add(options.beforeReconcile);
  const recoveryHooks = (shared[RECOVERY_HOOKS_KEY] as Set<NonNullable<RuntimeOptions['afterEnvelopeRecovery']>> | undefined)
    ?? new Set<NonNullable<RuntimeOptions['afterEnvelopeRecovery']>>();
  shared[RECOVERY_HOOKS_KEY] = recoveryHooks;
  if (options.afterEnvelopeRecovery) recoveryHooks.add(options.afterEnvelopeRecovery);

  const runReconcile = async (reason: ReconcileReason) => {
    const execute = async () => {
      // A failed ownership check is a hard safety barrier. Do not expire
      // envelopes, remove the pending restart generation, or release dispatch
      // readiness until every pre-reconcile hook succeeds in a later cycle.
      if (!await runBeforeReconcileHooks(hooks, reason)) return;
      const attemptedRestartNodes = [...pendingRestartNodes];
      await reconcileActiveRuns(supervisor, reason, attemptedRestartNodes, async () => {
        // The transactional restart recovery succeeded. Remove the old node
        // generation before any readiness hook can release new dispatches;
        // serialized cycles then cannot reapply it to this process's work.
        for (const nodeId of attemptedRestartNodes) pendingRestartNodes.delete(nodeId);
        for (const hook of recoveryHooks) {
          try {
            await hook(reason);
          } catch (error) {
            console.error(`[autonomous-delivery] ${reason} recovery hook failed:`, error);
          }
        }
      });
    };
    const previous = (shared[RECONCILE_CHAIN_KEY] as Promise<void> | undefined) ?? Promise.resolve();
    const current = previous.then(execute, execute);
    shared[RECONCILE_CHAIN_KEY] = current;
    await current;
  };

  const startedWorkers = (shared[STARTED_WORKERS_KEY] as Set<string> | undefined) ?? new Set<string>();
  shared[STARTED_WORKERS_KEY] = startedWorkers;
  const restartedNodeId = workerId.startsWith('daemon:')
    ? workerId.slice('daemon:'.length)
    : undefined;
  if (!startedWorkers.has(workerId)) {
    startedWorkers.add(workerId);
    if (restartedNodeId) pendingRestartNodes.add(restartedNodeId);
    void runReconcile('startup');
  }

  if (!shared[RECONCILE_TIMER_KEY]) {
    const timer = setInterval(() => {
      void runReconcile('periodic');
    }, Number(process.env.AUTONOMOUS_DELIVERY_RECONCILE_MS || 15_000));
    timer.unref();
    shared[RECONCILE_TIMER_KEY] = timer;
  }
  return supervisor;
}
