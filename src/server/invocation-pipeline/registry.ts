// Shared Invocation Pipeline registry.
import type { Server as IOServer } from 'socket.io';
import type { InvocationCoordinator } from './coordinator';

const coordinators = new WeakMap<IOServer, InvocationCoordinator>();
const INVOCATION_COORDINATOR_KEY = Symbol.for('agent-task-hub.invocation-pipeline.coordinator');

export function getInvocationCoordinator(io: IOServer): InvocationCoordinator | undefined {
  return coordinators.get(io)
    ?? ((io as unknown as Record<symbol, unknown>)[INVOCATION_COORDINATOR_KEY] as InvocationCoordinator | undefined);
}

export function registerInvocationCoordinator(io: IOServer, coordinator: InvocationCoordinator): void {
  coordinators.set(io, coordinator);
  (io as unknown as Record<symbol, unknown>)[INVOCATION_COORDINATOR_KEY] = coordinator;
}
