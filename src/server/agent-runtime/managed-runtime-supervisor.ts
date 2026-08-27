export interface ManagedAgentRuntimeKey {
  agentId: string;
  projectId: string;
  runtimeNodeId: string;
  runtimeId: string;
}

export type ManagedRuntimeLifecycle =
  | 'stopped'
  | 'starting'
  | 'listening'
  | 'waking'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'stopping';

export interface ManagedRuntimeCapacity {
  readyWorkers: number;
  totalWorkers: number;
  workerNames?: string[];
}

export interface ManagedRuntimeHandle {
  capacity(): ManagedRuntimeCapacity;
  subscriptionsReady(): boolean;
  stop(): void | Promise<void>;
}

export interface ManagedRuntimeStarter {
  start(input: {
    key: ManagedAgentRuntimeKey;
    generation: number;
    signal: AbortSignal;
  }): Promise<ManagedRuntimeHandle>;
}

export interface ManagedRuntimeSnapshot extends ManagedRuntimeCapacity {
  key: ManagedAgentRuntimeKey;
  generation: number;
  lifecycle: ManagedRuntimeLifecycle;
  acceptingWork: boolean;
  failureCount: number;
  reasonCode?: string;
  retryAt?: string;
  circuitOpenUntil?: string;
}

interface RuntimeEntry {
  key: ManagedAgentRuntimeKey;
  generation: number;
  lifecycle: ManagedRuntimeLifecycle;
  desired: 'running' | 'stopped';
  handle?: ManagedRuntimeHandle;
  start?: Promise<ManagedRuntimeSnapshot>;
  startAbort?: AbortController;
  failures: number[];
  reasonCode?: string;
  retryAt?: number;
  circuitOpenUntil?: number;
}

export interface ManagedAgentRuntimeSupervisorOptions {
  starter: ManagedRuntimeStarter;
  now?: () => number;
  retryBaseMs?: number;
  retryMaxMs?: number;
  circuitFailureThreshold?: number;
  circuitWindowMs?: number;
  circuitOpenMs?: number;
}

const DEFAULT_RETRY_BASE_MS = 5_000;
const DEFAULT_RETRY_MAX_MS = 300_000;
const DEFAULT_CIRCUIT_WINDOW_MS = 60_000;
const DEFAULT_CIRCUIT_OPEN_MS = 5 * 60_000;
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD = 3;

function runtimeKey(value: ManagedAgentRuntimeKey): string {
  return [value.agentId, value.projectId, value.runtimeNodeId].join('@');
}

/**
 * Owns desired/observed lifecycle for a managed Agent runtime. It deliberately
 * does not expose process handles: callers can ensure readiness, inspect a
 * snapshot, reconfigure, or stop. Generation fencing makes late startup
 * completions harmless.
 */
export class ManagedAgentRuntimeSupervisor {
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly transitions = new Map<string, Promise<ManagedRuntimeSnapshot>>();
  private shuttingDown = false;
  private readonly starter: ManagedRuntimeStarter;
  private readonly now: () => number;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitWindowMs: number;
  private readonly circuitOpenMs: number;

  constructor(options: ManagedAgentRuntimeSupervisorOptions) {
    this.starter = options.starter;
    this.now = options.now ?? Date.now;
    this.retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
    this.retryMaxMs = options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;
    this.circuitFailureThreshold = options.circuitFailureThreshold
      ?? DEFAULT_CIRCUIT_FAILURE_THRESHOLD;
    this.circuitWindowMs = options.circuitWindowMs ?? DEFAULT_CIRCUIT_WINDOW_MS;
    this.circuitOpenMs = options.circuitOpenMs ?? DEFAULT_CIRCUIT_OPEN_MS;
  }

  ensureReady(key: ManagedAgentRuntimeKey): Promise<ManagedRuntimeSnapshot> {
    const id = runtimeKey(key);
    if (this.shuttingDown) {
      const existing = this.entries.get(id);
      return Promise.resolve(existing ? this.snapshot(existing) : this.stoppedSnapshot(key, 1));
    }
    const transition = this.transitions.get(id);
    if (transition) return transition.then(() => this.ensureReady(key));
    const entry = this.entry(key);
    if (entry.key.runtimeId !== key.runtimeId) return this.reconfigure(key);
    return this.ensureEntryReady(entry, key);
  }

  private ensureEntryReady(
    entry: RuntimeEntry,
    key: ManagedAgentRuntimeKey,
  ): Promise<ManagedRuntimeSnapshot> {
    entry.desired = 'running';
    if (entry.handle) {
      this.refreshCapacity(entry);
      return Promise.resolve(this.snapshot(entry));
    }
    if (entry.start) return entry.start;

    const now = this.now();
    if (entry.circuitOpenUntil && entry.circuitOpenUntil > now) {
      entry.lifecycle = 'failed';
      entry.reasonCode = 'runtime_circuit_open';
      return Promise.resolve(this.snapshot(entry));
    }
    if (entry.circuitOpenUntil && entry.circuitOpenUntil <= now) {
      entry.circuitOpenUntil = undefined;
      entry.failures = [];
    }
    if (entry.retryAt && entry.retryAt > now) {
      entry.lifecycle = 'failed';
      entry.reasonCode = 'runtime_backoff';
      return Promise.resolve(this.snapshot(entry));
    }

    const generation = entry.generation;
    const abort = new AbortController();
    entry.startAbort = abort;
    entry.lifecycle = entry.failures.length === 0 ? 'starting' : 'waking';
    entry.reasonCode = undefined;
    const pending = this.starter.start({ key: entry.key, generation, signal: abort.signal })
      .then(async (handle) => {
        const current = this.entries.get(runtimeKey(key));
        if (!current || current !== entry || current.generation !== generation || current.desired !== 'running') {
          await handle.stop();
          return current ? this.snapshot(current) : this.stoppedSnapshot(key, generation);
        }
        entry.handle = handle;
        entry.failures = [];
        entry.retryAt = undefined;
        entry.circuitOpenUntil = undefined;
        entry.reasonCode = undefined;
        this.refreshCapacity(entry);
        return this.snapshot(entry);
      })
      .catch((error: unknown) => {
        const current = this.entries.get(runtimeKey(key));
        if (!current || current !== entry || current.generation !== generation) {
          return current ? this.snapshot(current) : this.stoppedSnapshot(key, generation);
        }
        const failedAt = this.now();
        entry.failures = [...entry.failures, failedAt]
          .filter((timestamp) => failedAt - timestamp <= this.circuitWindowMs);
        entry.lifecycle = 'failed';
        entry.reasonCode = abort.signal.aborted
          ? 'runtime_start_cancelled'
          : 'runtime_start_failed';
        if (entry.failures.length >= this.circuitFailureThreshold) {
          entry.circuitOpenUntil = failedAt + this.circuitOpenMs;
          entry.retryAt = undefined;
          entry.reasonCode = 'runtime_circuit_open';
        } else {
          const retryDelay = Math.min(
            this.retryMaxMs,
            this.retryBaseMs * 2 ** Math.max(0, entry.failures.length - 1),
          );
          entry.retryAt = failedAt + retryDelay;
        }
        // Public lifecycle snapshots carry stable reason codes only. Raw
        // adapter errors may contain commands, paths, prompts, or credentials.
        void error;
        return this.snapshot(entry);
      })
      .finally(() => {
        if (entry.start === pending) entry.start = undefined;
        if (entry.startAbort === abort) entry.startAbort = undefined;
      });
    entry.start = pending;
    return pending;
  }

  get(key: ManagedAgentRuntimeKey): ManagedRuntimeSnapshot | undefined {
    const entry = this.entries.get(runtimeKey(key));
    if (!entry) return undefined;
    if (entry.handle) this.refreshCapacity(entry);
    return this.snapshot(entry);
  }

  async reconfigure(key: ManagedAgentRuntimeKey): Promise<ManagedRuntimeSnapshot> {
    const id = runtimeKey(key);
    const apply = async (): Promise<ManagedRuntimeSnapshot> => {
      const entry = this.entry(key);
      if (this.shuttingDown) {
        await this.stopEntry(entry, true);
        return this.snapshot(entry);
      }
      // Publish desired identity and fence stale startup before any asynchronous
      // shutdown. A later ensureReady can no longer join the old start promise.
      entry.generation += 1;
      entry.key = { ...key };
      entry.desired = 'stopped';
      entry.lifecycle = 'stopping';
      entry.startAbort?.abort();
      entry.start = undefined;
      entry.startAbort = undefined;
      const handle = entry.handle;
      entry.handle = undefined;
      if (handle) await handle.stop();
      if (this.shuttingDown) {
        entry.desired = 'stopped';
        entry.lifecycle = 'stopped';
        return this.snapshot(entry);
      }
      entry.desired = 'running';
      entry.lifecycle = 'stopped';
      entry.failures = [];
      entry.reasonCode = undefined;
      entry.retryAt = undefined;
      entry.circuitOpenUntil = undefined;
      return this.ensureEntryReady(entry, key);
    };
    return this.enqueueTransition(id, apply);
  }

  async stop(key: ManagedAgentRuntimeKey): Promise<ManagedRuntimeSnapshot> {
    const id = runtimeKey(key);
    return this.enqueueTransition(id, async () => {
      const entry = this.entry(key);
      await this.stopEntry(entry, true);
      return this.snapshot(entry);
    });
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await Promise.all([...this.entries.entries()].map(([id, entry]) => (
      this.enqueueTransition(id, async () => {
        await this.stopEntry(entry, true);
        return this.snapshot(entry);
      })
    )));
  }

  private entry(key: ManagedAgentRuntimeKey): RuntimeEntry {
    const id = runtimeKey(key);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = {
        key: { ...key },
        generation: 1,
        lifecycle: 'stopped',
        desired: 'running',
        failures: [],
      };
      this.entries.set(id, entry);
    }
    return entry;
  }

  private enqueueTransition(
    id: string,
    apply: () => Promise<ManagedRuntimeSnapshot>,
  ): Promise<ManagedRuntimeSnapshot> {
    const previous = this.transitions.get(id);
    const pending = previous
      ? previous.catch(() => undefined).then(apply)
      : apply();
    this.transitions.set(id, pending);
    const clear = () => {
      if (this.transitions.get(id) === pending) this.transitions.delete(id);
    };
    void pending.then(clear, clear);
    return pending;
  }

  private async stopEntry(entry: RuntimeEntry, incrementGeneration: boolean): Promise<void> {
    entry.desired = 'stopped';
    entry.lifecycle = 'stopping';
    if (incrementGeneration) entry.generation += 1;
    entry.startAbort?.abort();
    entry.start = undefined;
    entry.startAbort = undefined;
    const handle = entry.handle;
    entry.handle = undefined;
    if (handle) await handle.stop();
    entry.lifecycle = 'stopped';
    entry.reasonCode = undefined;
    entry.retryAt = undefined;
    entry.circuitOpenUntil = undefined;
  }

  private refreshCapacity(entry: RuntimeEntry): void {
    if (!entry.handle) return;
    const capacity = entry.handle.capacity();
    if (!entry.handle.subscriptionsReady()) {
      entry.lifecycle = 'listening';
      return;
    }
    entry.lifecycle = capacity.readyWorkers >= capacity.totalWorkers && capacity.totalWorkers > 0
      ? 'ready'
      : capacity.readyWorkers > 0
        ? 'degraded'
        : 'listening';
  }

  private snapshot(entry: RuntimeEntry): ManagedRuntimeSnapshot {
    const capacity = entry.handle?.capacity() ?? { readyWorkers: 0, totalWorkers: 0 };
    return {
      key: { ...entry.key },
      generation: entry.generation,
      lifecycle: entry.lifecycle,
      acceptingWork: capacity.readyWorkers > 0
        && entry.desired === 'running'
        && Boolean(entry.handle?.subscriptionsReady()),
      ...capacity,
      failureCount: entry.failures.length,
      ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {}),
      ...(entry.retryAt ? { retryAt: new Date(entry.retryAt).toISOString() } : {}),
      ...(entry.circuitOpenUntil
        ? { circuitOpenUntil: new Date(entry.circuitOpenUntil).toISOString() }
        : {}),
    };
  }

  private stoppedSnapshot(
    key: ManagedAgentRuntimeKey,
    generation: number,
  ): ManagedRuntimeSnapshot {
    return {
      key: { ...key },
      generation,
      lifecycle: 'stopped',
      acceptingWork: false,
      readyWorkers: 0,
      totalWorkers: 0,
      failureCount: 0,
    };
  }
}
