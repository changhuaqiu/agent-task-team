import type { Server as IOServer } from 'socket.io';
import { autonomousDeliveryRepo } from './repository';
import {
  getAutonomousDeliverySupervisor,
  reconcileAutonomousDeliveryConversation,
  registerAutonomousDeliverySupervisor,
} from './registry';
import { deliveryAdvancementQueue } from './advancement-queue';
import {
  DeliveryControlRuntime,
  type AutonomousDeliveryRuntimePort,
} from './control-runtime';

const RECONCILE_TIMER_KEY = Symbol.for('agent-task-hub.autonomous-delivery.reconcile-timer');
const ADVANCEMENT_TIMER_KEY = Symbol.for('agent-task-hub.autonomous-delivery.advancement-timer');

async function reconcileActiveRuns(
  supervisor: AutonomousDeliveryRuntimePort,
  reason: 'startup' | 'periodic',
): Promise<void> {
  for (const run of autonomousDeliveryRepo.listReconcileCandidates()) {
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
): AutonomousDeliveryRuntimePort {
  const existing = getAutonomousDeliverySupervisor(io);
  const supervisor = existing ?? (() => {
    const created = new DeliveryControlRuntime({
      workerId,
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
  if (!shared[ADVANCEMENT_TIMER_KEY]) {
    deliveryAdvancementQueue.recover();
    let draining = false;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try {
        for (let count = 0; count < 100; count += 1) {
          const handled = await deliveryAdvancementQueue.runNext(
            (projectId, cause) => reconcileAutonomousDeliveryConversation(io, projectId, cause),
          );
          if (!handled) break;
        }
      } finally {
        draining = false;
      }
    };
    void drain();
    const timer = setInterval(() => void drain(), 250);
    timer.unref();
    shared[ADVANCEMENT_TIMER_KEY] = timer;
  }
  return supervisor;
}
