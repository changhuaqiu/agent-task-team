import type { AgentRun, ExecOptions } from '../agent/types';
import { resolveCatalogLauncher, type AgentCatalogEntry } from '../agent/acp/catalog';
import type { ManagedRuntimeHandle } from './managed-runtime-supervisor';
import { AgentWorkerPool, type AgentWorkerLease, type WorkerReleaseDisposition } from './agent-worker-pool';
import {
  PersistentAcpWorker,
  type PersistentAcpTurnConfig,
} from './persistent-acp-worker';
import { coordinateRuntimeStartup } from './runtime-startup-coordinator';

export interface ManagedAcpRuntimeConfig {
  entry: AgentCatalogEntry;
  cwd: string;
  env: Record<string, string>;
  workerCount: number;
  workerNames?: string[];
  cleanup?: () => void;
}

const TRANSPORT_FAILURES = new Set([
  'acp_cancelled',
  'acp_connection_failed',
  'acp_max_turn_timeout',
  'acp_process_exited',
  'acp_startup_failed',
  'acp_timeout',
]);

/** Production handle owned by ManagedAgentRuntimeSupervisor. */
export class ManagedAcpRuntime implements ManagedRuntimeHandle {
  private readonly pool = new AgentWorkerPool<PersistentAcpWorker>();
  private readonly workers = new Map<string, PersistentAcpWorker>();
  private readonly workerNames = new Map<string, string>();
  private nextWorkerId = 1;
  private listening = false;
  private stopped = false;
  private cleaned = false;

  private constructor(private readonly config: ManagedAcpRuntimeConfig) {}

  static async start(config: ManagedAcpRuntimeConfig, signal: AbortSignal): Promise<ManagedAcpRuntime> {
    const runtime = new ManagedAcpRuntime(config);
    await runtime.startInitialWorkers(signal);
    return runtime;
  }

  capacity() {
    return {
      ...this.pool.capacity(),
      workerNames: [...this.workerNames.entries()]
        .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
        .map(([, name]) => name),
    };
  }

  subscriptionsReady(): boolean {
    return this.listening && !this.stopped;
  }

  claim(laneId: string): ManagedAcpTurn | undefined {
    if (!this.subscriptionsReady()) return undefined;
    const lease = this.pool.claim(laneId);
    return lease ? new ManagedAcpTurn(this, lease) : undefined;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.listening = false;
    const workers = [...this.workers.values()];
    this.workers.clear();
    this.workerNames.clear();
    await Promise.allSettled(workers.map((worker) => worker.shutdown()));
    this.cleanup();
  }

  async release(lease: AgentWorkerLease<PersistentAcpWorker>, result: Awaited<AgentRun['result']>) {
    const disposition: WorkerReleaseDisposition = !lease.worker.ready()
      || (result.reasonCode ? TRANSPORT_FAILURES.has(result.reasonCode) : false)
      ? 'transport_failure'
      : result.status === 'completed'
        ? 'success'
        : 'application_failure';
    const released = this.pool.release(lease, disposition);
    if (!released.replaceWorker || !released.worker) return;
    const workerName = this.workerNames.get(lease.id);
    this.workers.delete(lease.id);
    this.workerNames.delete(lease.id);
    await released.worker.shutdown();
    if (!this.stopped) void this.addWorker(undefined, workerName).catch(() => {});
  }

  releaseUnstarted(lease: AgentWorkerLease<PersistentAcpWorker>) {
    this.pool.release(lease, 'application_failure');
  }

  private async startInitialWorkers(signal: AbortSignal) {
    const count = Math.max(1, Math.min(32, Math.floor(this.config.workerCount)));
    const attempts = await Promise.allSettled(
      Array.from({ length: count }, (_, index) => this.addWorker(
        signal,
        this.config.workerNames?.[index]?.trim() || `实例 ${index + 1}`,
      )),
    );
    this.listening = true;
    if (!attempts.some((attempt) => attempt.status === 'fulfilled')) {
      this.cleanup();
      const failure = attempts.find((attempt): attempt is PromiseRejectedResult => attempt.status === 'rejected');
      throw failure?.reason ?? new Error('acp_worker_pool_start_failed');
    }
  }

  private async addWorker(signal?: AbortSignal, preferredName?: string) {
    if (this.stopped || signal?.aborted) throw new Error('runtime_start_cancelled');
    const launcher = resolveCatalogLauncher(this.config.entry);
    const workerNumber = this.nextWorkerId++;
    const id = `acp-worker-${workerNumber}`;
    const worker = new PersistentAcpWorker({
      id,
      command: launcher.command,
      args: launcher.args,
      cwd: this.config.cwd,
      env: this.config.env,
      engine: this.config.entry.id,
      forwardNativeSubagentText: this.config.entry.id === 'claude',
    });
    await coordinateRuntimeStartup(
      this.config.entry.id,
      () => worker.start(signal),
    );
    if (this.stopped || signal?.aborted) {
      await worker.shutdown();
      throw new Error('runtime_start_cancelled');
    }
    this.workers.set(id, worker);
    this.workerNames.set(id, preferredName?.trim() || `实例 ${workerNumber}`);
    this.pool.add({ id, worker });
  }

  private cleanup() {
    if (this.cleaned) return;
    this.cleaned = true;
    this.config.cleanup?.();
  }
}

export class ManagedAcpTurn {
  private started = false;
  private abandoned = false;

  constructor(
    private readonly runtime: ManagedAcpRuntime,
    private readonly lease: AgentWorkerLease<PersistentAcpWorker>,
  ) {}

  execute(prompt: string, options: ExecOptions, config: PersistentAcpTurnConfig): AgentRun {
    if (this.started || this.abandoned) {
      throw new Error('acp_worker_lease_already_consumed');
    }
    this.started = true;
    const run = this.lease.worker.execute(prompt, options, config);
    const result = run.result.then(async (resolved) => {
      await this.runtime.release(this.lease, resolved);
      return resolved;
    });
    return { ...run, result };
  }

  abandon() {
    if (this.started || this.abandoned) return;
    this.abandoned = true;
    this.runtime.releaseUnstarted(this.lease);
  }
}
