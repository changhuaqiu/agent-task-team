import { PlatformEventDispatcher } from './dispatcher';
import { RuntimeInvocationProjection } from './runtime-invocation-projection';

let worker: PlatformEventRuntimeWorker | undefined;

type WorkerDispatcher = Pick<
  PlatformEventDispatcher,
  'register' | 'recover' | 'discover' | 'drain'
>;

export interface PlatformEventRuntimeWorkerOptions {
  intervalMs?: number;
  dispatcher?: WorkerDispatcher;
  projection?: RuntimeInvocationProjection;
}

export class PlatformEventRuntimeWorker {
  private readonly dispatcher: WorkerDispatcher;
  private readonly projection: RuntimeInvocationProjection;
  private readonly intervalMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private generation = 0;
  private recovered = false;

  constructor(options: number | PlatformEventRuntimeWorkerOptions = 250) {
    const resolved = typeof options === 'number' ? { intervalMs: options } : options;
    this.intervalMs = resolved.intervalMs ?? 250;
    this.dispatcher = resolved.dispatcher ?? new PlatformEventDispatcher();
    this.projection = resolved.projection ?? new RuntimeInvocationProjection();
    this.dispatcher.register({
      id: 'runtime-invocation-projection:v1',
      pattern: 'runtime.invocation.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: (event, { signal }) => this.projection.handle(event, signal),
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.recovered = false;
    this.schedule(0, this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delayMs: number, generation: number): void {
    if (this.stopped || generation !== this.generation) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().finally(() => this.schedule(this.intervalMs, generation));
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    try {
      if (!this.recovered) {
        this.dispatcher.recover();
        this.recovered = true;
      }
      this.dispatcher.discover();
      await this.dispatcher.drain();
    } catch (error) {
      console.error('[platform-event] dispatcher tick failed:', error);
    }
  }
}

export function startPlatformEventRuntime(intervalMs = 250): PlatformEventRuntimeWorker {
  worker ??= new PlatformEventRuntimeWorker(intervalMs);
  worker.start();
  return worker;
}
