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
} from './runtime-completion-process-manager';
import { DurableEffectOutbox } from './durable-effect-outbox';
import type { MessageRow } from '../repositories/message-repo';
import {
  A2AOutcomeProcessManager,
  type A2AOutcomeProcessManagerOptions,
} from '../a2a/outcome-process-manager';
import {
  A2ALifecycleProcessManager,
  type A2ALifecycleProcessManagerOptions,
} from '../a2a/lifecycle-process-manager';
import type { A2AProjectionSnapshot } from '../../shared/project-view-events';
import { A2AProjectViewProjection } from './a2a-project-view-projection';
import { ControlSlotReleaseProcessManager } from '../autonomous-delivery/control-slot-release-process-manager';
import { GateOutcomeProcessManager } from '../quality-gate/outcome-process-manager';
import { TaskGraphOutcomeProcessManager } from '../repositories/task-graph-outcome-process-manager';
import { TaskGraphSchedulerProcessManager } from '../repositories/task-graph-scheduler-process-manager';
import { TaskOutcomeProcessManager } from '../repositories/task-outcome-process-manager';
import {
  TaskGateLifecycleProcessManager,
} from '../repositories/task-gate-lifecycle-process-manager';
import { WorkLifecycleReconciler } from '../work-contract/work-lifecycle-reconciler';
import {
  createPhoenixHandlerRegistration,
  type PhoenixProjectionOverrides,
} from '../observability/phoenix-config';
import type { Server as IOServer } from 'socket.io';
import { TaskWorkLifecycleProcessManager } from '../invocation-pipeline/task-work-lifecycle-process-manager';
import { EvaluationWorkLifecycleProcessManager } from '../evaluation/evaluation-work-lifecycle-process-manager';
import { AutomationRuntime } from '../automations';
import { TaskProjectViewProjection } from './task-project-view-projection';

let worker: PlatformEventRuntimeWorker | undefined;

type WorkerDispatcher = Pick<
  PlatformEventDispatcher,
  'register' | 'recover' | 'discover' | 'drain'
>;
type WorkerEffects = Pick<DurableEffectOutbox, 'enqueueBatch' | 'recover' | 'drain'>;

export interface PlatformEventRuntimeWorkerOptions {
  intervalMs?: number;
  dispatcher?: WorkerDispatcher;
  projection?: RuntimeInvocationProjection;
  deliveryAdvancement?: DeliveryAdvancementPort;
  onObservabilityUpdated?: (projectId: string, invocationId: string) => void;
  onMessageProjected?: (message: MessageRow) => void;
  onA2AProjected?: (snapshot: A2AProjectionSnapshot) => void;
  effectOutbox?: WorkerEffects;
  a2aOutcome?: A2AOutcomeProcessManagerOptions | false;
  a2aLifecycle?: A2ALifecycleProcessManagerOptions | false;
  phoenix?: PhoenixProjectionOverrides | false;
  phoenixDispatcher?: WorkerDispatcher;
  io?: IOServer;
  automation?: Pick<AutomationRuntime, 'handle' | 'claimDueSchedules'> | false;
  workLifecycle?: WorkLifecycleReconciler;
}

export class PlatformEventRuntimeWorker {
  private readonly dispatcher: WorkerDispatcher;
  private readonly projection: RuntimeInvocationProjection;
  private readonly effects?: WorkerEffects;
  private readonly phoenixDispatcher?: WorkerDispatcher;
  private readonly automation?: Pick<AutomationRuntime, 'handle' | 'claimDueSchedules'>;
  private readonly intervalMs: number;
  private timer?: ReturnType<typeof setTimeout>;
  private phoenixTimer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private generation = 0;
  private recovered = false;
  private phoenixRecovered = false;

  constructor(options: number | PlatformEventRuntimeWorkerOptions = 250) {
    const resolved = typeof options === 'number' ? { intervalMs: options } : options;
    this.intervalMs = resolved.intervalMs ?? 250;
    this.dispatcher = resolved.dispatcher ?? new PlatformEventDispatcher();
    this.projection = resolved.projection ?? new RuntimeInvocationProjection();
    this.effects = resolved.effectOutbox;
    this.automation = resolved.automation === false ? undefined : resolved.automation;
    if (this.automation) {
      this.dispatcher.register({
        id: 'automation-runtime:v1',
        pattern: '*',
        stereotype: 'process_manager',
        reliability: 'durable',
        timeoutMs: 10_000,
        handle: this.automation.handle,
      });
    }
    this.dispatcher.register({
      id: 'runtime-invocation-projection:v1',
      pattern: 'runtime.invocation.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: (event, { signal }) => this.projection.handle(event, signal),
    });
    const messageProjection = new RuntimeMessageProjection({
      onProjected: resolved.onMessageProjected,
    });
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
    if (resolved.phoenix !== false) {
      const phoenix = createPhoenixHandlerRegistration(process.env, resolved.phoenix);
      if (phoenix) {
        this.phoenixDispatcher = resolved.phoenixDispatcher ?? new PlatformEventDispatcher();
        this.phoenixDispatcher.register(phoenix);
      }
    }
    const a2aProjectViewProjection = new A2AProjectViewProjection({
      onProjected: resolved.onA2AProjected,
    });
    this.dispatcher.register({
      id: 'a2a-project-view-projection:v1',
      pattern: 'a2a.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: a2aProjectViewProjection.handle,
    });
    if (resolved.effectOutbox) {
      const completionProcessManager = new RuntimeCompletionProcessManager(
        resolved.effectOutbox,
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
      id: 'task-wakeup-router:v2',
      supersedes: ['task-wakeup-router:v1'],
      pattern: 'task.*',
      stereotype: 'router',
      reliability: 'durable',
      handle: taskWakeupRouter.handle,
    });
    if (resolved.io) {
      const taskProjectView = new TaskProjectViewProjection(resolved.io);
      this.dispatcher.register({
        id: 'task-project-view-projection:v1',
        pattern: 'task.*',
        stereotype: 'projection',
        reliability: 'durable',
        handle: taskProjectView.handle,
      });
      const taskWorkLifecycle = new TaskWorkLifecycleProcessManager(resolved.io);
      this.dispatcher.register({
        id: 'task-work-lifecycle-process-manager:v1',
        pattern: 'agent.work.*',
        stereotype: 'process_manager',
        reliability: 'durable',
        handle: taskWorkLifecycle.handle,
      });
    }
    const evaluationWorkLifecycle = new EvaluationWorkLifecycleProcessManager();
    this.dispatcher.register({
      id: 'evaluation-work-lifecycle-process-manager:v1',
      pattern: 'agent.work.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: evaluationWorkLifecycle.handle,
    });
    const workLifecycle = resolved.workLifecycle ?? new WorkLifecycleReconciler();
    for (const [id, pattern] of [
      ['work-lifecycle-reconciler:task:v1', 'task.*'],
      ['work-lifecycle-reconciler:delivery:v1', 'delivery.run.*'],
      ['work-lifecycle-reconciler:late-inbox:v1', 'agent.work.enqueued'],
      ['work-lifecycle-reconciler:runtime:v1', 'runtime.invocation.terminated'],
      ['work-lifecycle-reconciler:a2a:v1', 'a2a.pass.*'],
    ] as const) {
      this.dispatcher.register({
        id,
        pattern,
        stereotype: 'process_manager',
        reliability: 'durable',
        timeoutMs: 5_000,
        handle: workLifecycle.handle,
      });
    }
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
      for (const [id, pattern] of [
        ['delivery-process-manager-gate:v1', 'gate.*'],
        ['delivery-process-manager-runtime:v1', 'runtime.*'],
        ['delivery-process-manager-context:v1', 'context.*'],
        ['delivery-process-manager-effect:v1', 'effect.*'],
        ['delivery-process-manager-control:v1', 'control.action.failed'],
      ] as const) {
        this.dispatcher.register({
          id,
          pattern,
          stereotype: 'process_manager',
          reliability: 'durable',
          timeoutMs: 5_000,
          handle: deliveryProcessManager.handle,
        });
      }
    }
    const controlSlotRelease = new ControlSlotReleaseProcessManager();
    this.dispatcher.register({
      id: 'control-slot-release-process-manager:v1',
      pattern: 'runtime.invocation.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: controlSlotRelease.handle,
    });
    this.dispatcher.register({
      id: 'control-slot-release-process-manager:context:v1',
      pattern: 'context.snapshot.rejected',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: controlSlotRelease.handle,
    });
    this.dispatcher.register({
      id: 'control-slot-release-process-manager:inbox:v1',
      pattern: 'agent.work.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: controlSlotRelease.handle,
    });
    this.dispatcher.register({
      id: 'control-slot-release-process-manager:work:v1',
      pattern: 'work.authority.closed',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: controlSlotRelease.handle,
    });
    if (resolved.a2aOutcome !== false) {
      const a2aOutcome = new A2AOutcomeProcessManager(resolved.a2aOutcome);
      this.dispatcher.register({
        id: 'a2a-outcome-process-manager:v3',
        supersedes: ['a2a-outcome-process-manager:v1', 'a2a-outcome-process-manager:v2'],
        pattern: 'agent.outcome.accepted',
        stereotype: 'process_manager',
        reliability: 'durable',
        timeoutMs: 5_000,
        handle: a2aOutcome.handle,
      });
    }
    const gateOutcome = new GateOutcomeProcessManager();
    this.dispatcher.register({
      id: 'gate-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: gateOutcome.handle,
    });
    const taskGraphOutcome = new TaskGraphOutcomeProcessManager();
    this.dispatcher.register({
      id: 'task-graph-outcome-process-manager:v2',
      supersedes: ['task-graph-outcome-process-manager:v1'],
      pattern: 'agent.outcome.accepted',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: taskGraphOutcome.handle,
    });
    const taskGraphScheduler = new TaskGraphSchedulerProcessManager();
    this.dispatcher.register({
      id: 'task-graph-scheduler-process-manager:v1',
      pattern: 'task.done',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: taskGraphScheduler.handle,
    });
    const taskOutcome = new TaskOutcomeProcessManager();
    this.dispatcher.register({
      id: 'task-outcome-process-manager:v1',
      pattern: 'agent.outcome.accepted',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: taskOutcome.handle,
    });
    const taskGateLifecycle = new TaskGateLifecycleProcessManager();
    this.dispatcher.register({
      id: 'task-gate-lifecycle-process-manager:v1',
      pattern: 'gate.*',
      stereotype: 'process_manager',
      reliability: 'durable',
      timeoutMs: 5_000,
      handle: taskGateLifecycle.handle,
    });
    if (resolved.a2aLifecycle !== false) {
      const a2aLifecycle = new A2ALifecycleProcessManager(resolved.a2aLifecycle);
      for (const [id, pattern] of [
        ['a2a-lifecycle-agent-work:v1', 'agent.work.*'],
        ['a2a-lifecycle-runtime:v1', 'runtime.invocation.*'],
      ] as const) {
        this.dispatcher.register({
          id,
          pattern,
          stereotype: 'process_manager',
          reliability: 'durable',
          timeoutMs: 5_000,
          handle: a2aLifecycle.handle,
        });
      }
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.recovered = false;
    this.phoenixRecovered = false;
    this.schedule(0, this.generation);
    this.schedulePhoenix(0, this.generation);
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    if (this.phoenixTimer) clearTimeout(this.phoenixTimer);
    this.timer = undefined;
    this.phoenixTimer = undefined;
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
        this.effects?.recover();
        this.recovered = true;
      }
      this.automation?.claimDueSchedules();
      this.dispatcher.discover();
      await this.dispatcher.drain();
      await this.effects?.drain();
    } catch (error) {
      console.error('[platform-event] dispatcher tick failed:', error);
    }
  }

  private schedulePhoenix(delayMs: number, generation: number): void {
    if (!this.phoenixDispatcher || this.stopped || generation !== this.generation) return;
    this.phoenixTimer = setTimeout(() => {
      this.phoenixTimer = undefined;
      void this.phoenixTick().finally(() => this.schedulePhoenix(this.intervalMs, generation));
    }, delayMs);
    this.phoenixTimer.unref?.();
  }

  private async phoenixTick(): Promise<void> {
    if (!this.phoenixDispatcher) return;
    try {
      if (!this.phoenixRecovered) {
        this.phoenixDispatcher.recover();
        this.phoenixRecovered = true;
      }
      this.phoenixDispatcher.discover();
      await this.phoenixDispatcher.drain();
    } catch (error) {
      console.error('[phoenix] export worker tick failed:', error);
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
