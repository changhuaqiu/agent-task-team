const startupTails = new Map<string, Promise<void>>();

export interface CoordinateRuntimeStartupOptions {
  cooldownMs?: number;
}

function cooldown(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * OpenCode processes share a host database and second-granularity log names.
 * Serialize only their cold-start handshake, then let established workers run
 * turns concurrently.
 */
export async function coordinateRuntimeStartup<T>(
  runtimeId: string,
  start: () => Promise<T>,
  options: CoordinateRuntimeStartupOptions = {},
): Promise<T> {
  if (runtimeId !== 'opencode') return start();

  const previous = startupTails.get(runtimeId)?.catch(() => undefined)
    ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => gate);
  startupTails.set(runtimeId, queued);

  await previous;
  try {
    return await start();
  } finally {
    await cooldown(options.cooldownMs ?? 1_100);
    release();
    if (startupTails.get(runtimeId) === queued) startupTails.delete(runtimeId);
  }
}
