import type { Server as IOServer } from 'socket.io';
import type { GoalContract } from './types';
import type {
  AdvanceResult,
  AdvancementCause,
} from './supervisor';
import { AutonomousDeliverySupervisor } from './supervisor';
import { autonomousDeliveryRepo } from './repository';

const supervisors = new WeakMap<IOServer, AutonomousDeliverySupervisor>();
const SUPERVISOR_KEY = Symbol.for('agent-task-hub.autonomous-delivery.supervisor');

function getSupervisor(io: IOServer | undefined): AutonomousDeliverySupervisor | undefined {
  if (!io) return undefined;
  return supervisors.get(io)
    ?? ((io as unknown as Record<symbol, unknown>)[SUPERVISOR_KEY] as AutonomousDeliverySupervisor | undefined);
}

export function getAutonomousDeliverySupervisor(
  io: IOServer | undefined,
): AutonomousDeliverySupervisor | undefined {
  return getSupervisor(io);
}

export function registerAutonomousDeliverySupervisor(
  io: IOServer,
  supervisor: AutonomousDeliverySupervisor,
): void {
  supervisors.set(io, supervisor);
  // Next.js may evaluate API routes and daemon setup in separate bundles.
  // Keep the instance on the shared Socket.IO server as the cross-bundle source of truth.
  (io as unknown as Record<symbol, unknown>)[SUPERVISOR_KEY] = supervisor;
}

export function startAutonomousDelivery(
  io: IOServer | undefined,
  contract: GoalContract,
): ReturnType<AutonomousDeliverySupervisor['start']> | undefined {
  return getSupervisor(io)?.start(contract);
}

export function advanceAutonomousDelivery(
  io: IOServer | undefined,
  runId: string,
  cause: AdvancementCause,
): Promise<AdvanceResult> | undefined {
  return getSupervisor(io)?.advance(runId, cause);
}

export function reconcileAutonomousDeliveryConversation(
  io: IOServer | undefined,
  conversationId: string,
  cause: AdvancementCause = { kind: 'fact_changed' },
): Promise<AdvanceResult> | undefined {
  if (!io) return undefined;
  const snapshot = autonomousDeliveryRepo.getLatestByConversation(conversationId);
  if (!snapshot || ['completed', 'escalated', 'cancelled'].includes(snapshot.run.status)) return undefined;
  return getSupervisor(io)?.advance(snapshot.run.id, cause);
}
