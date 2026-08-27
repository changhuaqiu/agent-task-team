import { getDb } from '@/server/db';

type DrainHandler = () => void | Promise<void>;

const DRAIN_HANDLER = Symbol.for('agent-task-hub.desktop-service-drain');

type DesktopLifecycleGlobal = typeof globalThis & {
  [DRAIN_HANDLER]?: DrainHandler;
};

export function registerDesktopServiceDrain(handler: DrainHandler): void {
  (globalThis as DesktopLifecycleGlobal)[DRAIN_HANDLER] = handler;
}

export async function drainDesktopService(): Promise<void> {
  await (globalThis as DesktopLifecycleGlobal)[DRAIN_HANDLER]?.();
  const db = getDb();
  db.pragma('wal_checkpoint(TRUNCATE)');
}
