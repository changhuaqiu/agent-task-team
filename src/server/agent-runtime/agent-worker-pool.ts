export type WorkerReleaseDisposition = 'success' | 'application_failure' | 'transport_failure';

export interface AgentWorker<TWorker> {
  id: string;
  worker: TWorker;
}

export interface AgentWorkerLease<TWorker> extends AgentWorker<TWorker> {
  laneId: string;
  leaseId: number;
}

interface WorkerSlot<TWorker> extends AgentWorker<TWorker> {
  busy: boolean;
  leaseId: number;
}

/** Persistent worker ownership, one active turn per worker, with lane affinity. */
export class AgentWorkerPool<TWorker> {
  private readonly slots = new Map<string, WorkerSlot<TWorker>>();
  private readonly affinity = new Map<string, string>();
  private nextLeaseId = 1;

  add(worker: AgentWorker<TWorker>): void {
    if (this.slots.has(worker.id)) throw new Error(`agent_worker_duplicate:${worker.id}`);
    this.slots.set(worker.id, { ...worker, busy: false, leaseId: 0 });
  }

  remove(workerId: string): TWorker | undefined {
    const slot = this.slots.get(workerId);
    if (!slot) return undefined;
    this.slots.delete(workerId);
    for (const [laneId, ownerId] of this.affinity) {
      if (ownerId === workerId) this.affinity.delete(laneId);
    }
    return slot.worker;
  }

  claim(laneId: string): AgentWorkerLease<TWorker> | undefined {
    const preferredId = this.affinity.get(laneId);
    const preferred = preferredId ? this.slots.get(preferredId) : undefined;
    // A lane with an affine worker must wait for that worker. Falling through
    // to another idle worker would create two concurrent turns for one session.
    if (preferred?.busy) return undefined;
    const slot = preferred ?? [...this.slots.values()].find((candidate) => !candidate.busy);
    if (!slot) return undefined;
    slot.busy = true;
    slot.leaseId = this.nextLeaseId++;
    this.affinity.set(laneId, slot.id);
    return { id: slot.id, worker: slot.worker, laneId, leaseId: slot.leaseId };
  }

  release(
    lease: AgentWorkerLease<TWorker>,
    disposition: WorkerReleaseDisposition,
  ): { replaceWorker: boolean; worker?: TWorker } {
    const slot = this.slots.get(lease.id);
    if (!slot || slot.worker !== lease.worker || slot.leaseId !== lease.leaseId) {
      return { replaceWorker: false };
    }
    if (disposition === 'transport_failure') {
      return { replaceWorker: true, worker: this.remove(lease.id) };
    }
    slot.busy = false;
    slot.leaseId = 0;
    return { replaceWorker: false };
  }

  capacity(): { readyWorkers: number; totalWorkers: number } {
    return {
      readyWorkers: [...this.slots.values()].filter((slot) => !slot.busy).length,
      totalWorkers: this.slots.size,
    };
  }

  affinityOwner(laneId: string): string | undefined {
    return this.affinity.get(laneId);
  }
}
