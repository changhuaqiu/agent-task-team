import { PlatformEventDispatcher } from './dispatcher';
import { RuntimeInvocationProjection } from './runtime-invocation-projection';
import { TaskWakeupRouter } from './task-wakeup-router';
import {
  DeliveryProcessManager,
  type DeliveryAdvancementPort,
} from './delivery-process-manager';
import { RuntimeMessageProjection } from './runtime-message-projection';
import { RuntimeObservabilityProjection } from './runtime-observability-projection';
import {
  RuntimeCompletionProcessManager,
  type RuntimeCompletionPort,
} from './runtime-completion-process-manager';

let worker: PlatformEventRuntimeWorker | undefined;

type WorkerDispatcher = Pick<
  PlatformEventDispatcher,
  'register' | 'recover' | 'discover' | 'drain'
>;

export interface PlatformEventRuntimeWorkerOptions {
  intervalMs?: number;
  dispatcher?: WorkerDispatcher;
  projection?: RuntimeInvocationProjection;
  deliveryAdvancement?: DeliveryAdvancementPort;
  onObservabilityUpdated?: (projectId: string, invocationId: string) => void;
  runtimeCompletion?: RuntimeCompletionPort;
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
    const messageProjection = new RuntimeMessageProjection();
    this.dispatcher.register({
      id: 'runtime-message-projection:v1',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: messageProjection.handle,
    });
    const observabilityProjection = new RuntimeObservabilityProjection({
      onUpdated: resolved.onObservabilityUpdated,
    });
    this.dispatcher.register({
      id: 'runtime-observability-projection:v1',
      pattern: 'runtime.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: observabilityProjection.handle,
    });
    if (resolved.runtimeCompletion) {
      const completionProcessManager = new RuntimeCompletionProcessManager(
        resolved.runtimeCompletion,
      );
      this.dispatcher.register({
        id: 'runtime-completion-process-manager:v1',
        pattern: 'runtime.invocation.terminated',
        stereotype: 'process_manager',
        reliability: 'durable',
        handle: completionProcessManager.handle,
      });
    }
    const taskWakeupRouter = new TaskWakeupRouter();
    this.dispatcher.register({
      id: 'task-wakeup-router:v1',
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      handle: taskWakeupRouter.handle,
    });
    if (resolved.deliveryAdvancement) {
      const deliveryProcessManager = new DeliveryProcessManager(resolved.deliveryAdvancement);
      this.dispatcher.register({
        id: 'delivery-process-manager-task:v1',
        pattern: 'task.*',
        stereotype: 'process_manager',
        reliability: 'durable',
        timeoutMs: 5_000,
        handle: deliveryProcessManager.handle,
      });
      this.dispatcher.register({
        id: 'delivery-process-manager-review:v1',
        pattern: 'review.*',
        stereotype: 'process_manager',
        reliability: 'durable',
        timeoutMs: 5_000,
        handle: deliveryProcessManager.handle,
      });
    }
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

export function startPlatformEventRuntime(
  options: number | PlatformEventRuntimeWorkerOptions = 250,
): PlatformEventRuntimeWorker {
  worker ??= new PlatformEventRuntimeWorker(options);
  worker.start();
  return worker;
}
