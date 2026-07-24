import { PlatformEventDispatcher } from './dispatcher';
import { RuntimeInvocationProjection } from './runtime-invocation-projection';

let worker: PlatformEventRuntimeWorker | undefined;

export class PlatformEventRuntimeWorker {
  private readonly dispatcher = new PlatformEventDispatcher();
  private readonly projection = new RuntimeInvocationProjection();
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly intervalMs = 250) {
    this.dispatcher.register({
      id: 'runtime-invocation-projection:v1',
      pattern: 'runtime.invocation.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: (event, { signal }) => this.projection.handle(event, signal),
    });
  }

  start(): void {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    try {
      this.dispatcher.recover();
      void this.dispatcher.drain().catch((error) => {
        console.error('[platform-event] dispatcher drain failed:', error);
      });
    } catch (error) {
      console.error('[platform-event] dispatcher recovery failed:', error);
    }
  }
}

export function startPlatformEventRuntime(intervalMs = 250): PlatformEventRuntimeWorker {
  worker ??= new PlatformEventRuntimeWorker(intervalMs);
  worker.start();
  return worker;
}
