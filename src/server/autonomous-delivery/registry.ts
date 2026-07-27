import type { Server as IOServer } from 'socket.io';
import type { GoalContract } from './types';
import type { AdvanceResult, AdvancementCause } from './types';
import type { AutonomousDeliveryRuntimePort } from './control-runtime';
import { autonomousDeliveryRepo } from './repository';

const runtimes = new WeakMap<IOServer, AutonomousDeliveryRuntimePort>();
const RUNTIME_KEY = Symbol.for('agent-task-hub.autonomous-delivery.control-runtime');

function getRuntime(io: IOServer | undefined): AutonomousDeliveryRuntimePort | undefined {
  if (!io) return undefined;
  return runtimes.get(io)
    ?? ((io as unknown as Record<symbol, unknown>)[RUNTIME_KEY] as AutonomousDeliveryRuntimePort | undefined);
}

export function getDeliveryControlRuntime(
  io: IOServer | undefined,
): AutonomousDeliveryRuntimePort | undefined {
  return getRuntime(io);
}

export function registerDeliveryControlRuntime(
  io: IOServer,
  runtime: AutonomousDeliveryRuntimePort,
): void {
  runtimes.set(io, runtime);
  // Next.js may evaluate API routes and daemon setup in separate bundles.
  // Keep the instance on the shared Socket.IO server as the cross-bundle source of truth.
  (io as unknown as Record<symbol, unknown>)[RUNTIME_KEY] = runtime;
}

export function startAutonomousDelivery(
  io: IOServer | undefined,
  contract: GoalContract,
): ReturnType<AutonomousDeliveryRuntimePort['start']> | undefined {
  return getRuntime(io)?.start(contract);
}

export function advanceAutonomousDelivery(
  io: IOServer | undefined,
  runId: string,
  cause: AdvancementCause,
): Promise<AdvanceResult> | undefined {
  return getRuntime(io)?.advance(runId, cause);
}

export function reconcileAutonomousDeliveryConversation(
  io: IOServer | undefined,
  conversationId: string,
  cause: AdvancementCause = { kind: 'fact_changed' },
): Promise<AdvanceResult> | undefined {
  if (!io) return undefined;
  const snapshot = autonomousDeliveryRepo.getLatestByConversation(conversationId);
  if (!snapshot || ['completed', 'failed', 'cancelled'].includes(snapshot.run.status)) return undefined;
  return getRuntime(io)?.advance(snapshot.run.id, cause);
}
