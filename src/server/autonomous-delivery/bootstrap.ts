import type { Server as IOServer } from 'socket.io';
import {
  HarnessDeliveryActionAdapter,
  RepositoryDeliveryFactsAdapter,
} from './production-adapters';
import { autonomousDeliveryRepo } from './repository';
import {
  getAutonomousDeliverySupervisor,
  registerAutonomousDeliverySupervisor,
} from './registry';
import { AutonomousDeliverySupervisor } from './supervisor';
import { GitHubProviderActionAdapter } from './provider-actions';

const RECONCILE_TIMER_KEY = Symbol.for('agent-task-hub.autonomous-delivery.reconcile-timer');

function deliveryLeaseMs(): number {
  const configured = Number(process.env.AUTONOMOUS_DELIVERY_LEASE_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
}

async function reconcileActiveRuns(
  supervisor: AutonomousDeliverySupervisor,
  reason: 'startup' | 'periodic',
): Promise<void> {
  for (const run of autonomousDeliveryRepo.listActive()) {
    try {
      await supervisor.advance(run.id, { kind: 'periodic_reconcile', ref: reason });
    } catch (error) {
      console.error(`[autonomous-delivery] ${reason} reconcile failed for ${run.id}:`, error);
    }
  }
}

export function ensureAutonomousDeliveryRuntime(
  io: IOServer,
  workerId = 'server:autonomous-delivery',
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
  if (!shared[RECONCILE_TIMER_KEY]) {
    void reconcileActiveRuns(supervisor, 'startup');
    const timer = setInterval(() => {
      void reconcileActiveRuns(supervisor, 'periodic');
    }, Number(process.env.AUTONOMOUS_DELIVERY_RECONCILE_MS || 15_000));
    timer.unref();
    shared[RECONCILE_TIMER_KEY] = timer;
  }
  return supervisor;
}
