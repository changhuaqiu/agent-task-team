import type { InvocationDispatchPlan } from '../invocation-pipeline/types';
import { ProcessStartGuard } from '../process-start-guard';

export interface ActiveAgentProcess {
  kill(): void;
}

/** Owns turn admission and bounded process cancellation for local Agent runs. */
export class AgentProcessRegistry {
  private readonly active = new Map<string, ActiveAgentProcess>();
  private readonly starts = new ProcessStartGuard();

  isBusy(agentId: string, projectId: string): boolean {
    return this.active.has(this.key(agentId, projectId));
  }

  reserve(plan: InvocationDispatchPlan): boolean {
    const key = this.key(plan.trigger.agentId, plan.trigger.conversationId);
    return this.starts.claim(key, this.active.has(key), false);
  }

  releaseReservation(plan: InvocationDispatchPlan): void {
    this.starts.release(this.key(plan.trigger.agentId, plan.trigger.conversationId));
  }

  attach(agentId: string, projectId: string, process: ActiveAgentProcess): void {
    const key = this.key(agentId, projectId);
    this.active.set(key, process);
    this.starts.markStarted(key);
  }

  get(agentId: string, projectId: string): ActiveAgentProcess | undefined {
    return this.active.get(this.key(agentId, projectId));
  }

  cancel(agentId: string, projectId?: string): number {
    let cancelled = 0;
    for (const [key, process] of [...this.active.entries()]) {
      if (!key.startsWith(`${agentId}@`)) continue;
      if (projectId && key !== this.key(agentId, projectId)) continue;
      process.kill();
      this.active.delete(key);
      cancelled += 1;
    }
    return cancelled;
  }

  remove(agentId: string, projectId: string, expected?: ActiveAgentProcess): void {
    const key = this.key(agentId, projectId);
    if (expected && this.active.get(key) !== expected) return;
    this.active.delete(key);
  }

  entries(): IterableIterator<[string, ActiveAgentProcess]> {
    return this.active.entries();
  }

  shutdown(): void {
    for (const process of this.active.values()) process.kill();
    this.active.clear();
  }

  private key(agentId: string, projectId?: string): string {
    return `${agentId}@${projectId || 'default'}`;
  }
}
