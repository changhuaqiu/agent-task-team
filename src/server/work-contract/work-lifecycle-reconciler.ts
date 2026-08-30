import { getDb } from '../db';
import { CollaborationKernel } from '../collaboration-kernel';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { WorkContractRepository } from './repository';
import { parseWorkIdentity } from './work-identity';
import { invocationRepo, type InvocationRow } from '../repositories/invocation-repo';

const TERMINAL_TASK_EVENTS = new Set(['task.done', 'task.cancelled']);
const TERMINAL_DELIVERY_EVENTS = new Set([
  'delivery.run.completed',
  'delivery.run.failed',
  'delivery.run.cancelled',
]);
const TERMINAL_A2A_PASS_EVENTS = new Set(['a2a.pass.completed', 'a2a.pass.failed']);
const TERMINAL_A2A_PASS_STATUSES = new Set(['completed', 'blocked', 'rejected', 'timeout', 'error']);

export interface WorkLifecycleReconcilerOptions {
  collaboration?: CollaborationKernel;
  contracts?: WorkContractRepository;
  now?: () => Date;
}

export interface WorkLifecycleRecoveryReport {
  staleInvocationsTerminated: number;
  authoritiesClosed: number;
}

/**
 * Reclaims runtime-side Work once its Task or Delivery owner is terminal.
 * Historical terminal events are safe to replay because authority close and
 * Inbox cancellation are both idempotent and current owner state is re-read.
 */
export class WorkLifecycleReconciler {
  private readonly collaboration: CollaborationKernel;
  private readonly contracts: WorkContractRepository;
  private readonly now: () => Date;

  constructor(options: WorkLifecycleReconcilerOptions = {}) {
    this.collaboration = options.collaboration ?? new CollaborationKernel();
    this.contracts = options.contracts ?? new WorkContractRepository();
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Restores owner/attempt convergence after a process crash or an older build
   * that consumed the terminal event before WorkAuthority cleanup existed.
   */
  reconcilePersistedState(now: Date = this.now()): WorkLifecycleRecoveryReport {
    const timestamp = now.toISOString();
    let staleInvocationsTerminated = 0;
    let authoritiesClosed = 0;
    const staleInvocations = getDb().prepare(`
      SELECT * FROM invocation
      WHERE status IN ('starting','running','terminating')
        AND lease_expiry IS NOT NULL AND lease_expiry<=?
      ORDER BY created_at,id
    `).all(timestamp) as InvocationRow[];
    for (const invocation of staleInvocations) {
      const terminated = invocationRepo.transition(invocation.id, {
        to: 'terminated',
        expectedFrom: invocation.status,
        outcome: 'failed',
        exit_code: 1,
        reason_code: 'orphaned_runtime_owner_lease_expired',
        error_message: 'Runtime owner lease expired before Invocation termination',
      });
      if (terminated?.status === 'terminated') staleInvocationsTerminated += 1;
    }

    const failedInvocations = getDb().prepare(`
      SELECT invocation.* FROM invocation
      JOIN work_contract ON work_contract.attempt_id=invocation.id
      JOIN work_authority ON work_authority.current_contract_id=work_contract.id
      WHERE work_authority.status='active'
        AND invocation.status='terminated'
        AND invocation.outcome<>'completed'
      ORDER BY invocation.terminated_at,invocation.id
    `).all() as InvocationRow[];
    for (const invocation of failedInvocations) {
      if (this.reconcileInvocation(invocation.id, timestamp, now)) authoritiesClosed += 1;
    }

    const terminalPasses = getDb().prepare(`
      SELECT pass.id,chain.conversation_id
      FROM a2a_pass pass
      JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
      WHERE pass.status IN ('completed','blocked','rejected','timeout','error')
      ORDER BY pass.updated_at,pass.id
    `).all() as Array<{ id: string; conversation_id: string }>;
    for (const pass of terminalPasses) {
      if (this.closeWork(
        pass.conversation_id,
        `a2a-pass:${pass.id}`,
        `a2a-pass:${pass.id}`,
        'startup_terminal_a2a_pass',
        now,
        'a2a_pass_terminal',
      )) authoritiesClosed += 1;
    }

    const terminalTasks = getDb().prepare(`
      SELECT id,conversation_id FROM task
      WHERE status IN ('done','cancelled')
      ORDER BY updated_at,id
    `).all() as Array<{ id: string; conversation_id: string }>;
    for (const task of terminalTasks) {
      authoritiesClosed += this.reconcileTask(
        task.conversation_id,
        task.id,
        `task:${task.id}`,
        'startup_terminal_task',
        now,
      );
    }
    return { staleInvocationsTerminated, authoritiesClosed };
  }

  /**
   * Settles one persisted Invocation without depending on the runtime event
   * coordinator having been constructed. This is the setup-failure seam used
   * by both daemon catch paths and the durable terminal-event handler.
   */
  reconcileInvocation(
    invocationId: string,
    causationId: string,
    now: Date = this.now(),
  ): boolean {
    const invocation = invocationRepo.getById(invocationId);
    return invocation ? this.reconcileFailedInvocation(invocation, causationId, now) : false;
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (signal.aborted) throw signal.reason ?? new Error('work_lifecycle_reconcile_aborted');
    if (event.type === 'runtime.invocation.terminated') {
      const payload = event.payload as { outcome?: string };
      if (event.invocationId && payload.outcome !== 'completed') {
        this.reconcileInvocation(event.invocationId, event.eventId, new Date(event.recordedAt));
      }
      return;
    }
    if (TERMINAL_A2A_PASS_EVENTS.has(event.type)) {
      const pass = getDb().prepare(`
        SELECT pass.id,pass.status,chain.conversation_id
        FROM a2a_pass pass
        JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
        WHERE pass.id=?
      `).get(event.aggregate.id) as {
        id: string;
        status: string;
        conversation_id: string;
      } | undefined;
      if (pass && TERMINAL_A2A_PASS_STATUSES.has(pass.status)) {
        this.closeWork(
          pass.conversation_id,
          `a2a-pass:${pass.id}`,
          event.correlationId,
          event.eventId,
          new Date(event.recordedAt),
          'a2a_pass_terminal',
        );
      }
      return;
    }
    if (event.type === 'agent.work.enqueued') {
      const command = event.payload as {
        workId?: string;
        taskId?: string;
        deliveryRunId?: string;
      };
      const delivery = command.deliveryRunId ? getDb().prepare(`
        SELECT status FROM autonomous_delivery_run WHERE id=? AND conversation_id=?
      `).get(command.deliveryRunId, event.projectId) as { status: string } | undefined : undefined;
      if (
        command.deliveryRunId
        && delivery
        && ['completed', 'failed', 'cancelled'].includes(delivery.status)
      ) {
        this.reconcileDelivery(
          event.projectId,
          command.deliveryRunId,
          event.correlationId,
          event.eventId,
          new Date(event.recordedAt),
        );
        return;
      }
      const identity = parseWorkIdentity(command.workId);
      const task = command.taskId ? getDb().prepare(`
        SELECT status FROM task WHERE id=? AND conversation_id=?
      `).get(command.taskId, event.projectId) as { status: string } | undefined : undefined;
      if (
        command.taskId
        && task
        && identity?.scope !== 'delivery'
        && ['done', 'cancelled'].includes(task.status)
      ) {
        this.reconcileTask(
          event.projectId,
          command.taskId,
          event.correlationId,
          event.eventId,
          new Date(event.recordedAt),
        );
      }
      return;
    }
    if (TERMINAL_TASK_EVENTS.has(event.type)) {
      const task = getDb().prepare(`
        SELECT conversation_id,status FROM task WHERE id=?
      `).get(event.aggregate.id) as { conversation_id: string; status: string } | undefined;
      if (
        !task
        || task.conversation_id !== event.projectId
        || !['done', 'cancelled'].includes(task.status)
      ) return;
      this.reconcileTask(
        event.projectId,
        event.aggregate.id,
        event.correlationId,
        event.eventId,
        new Date(event.recordedAt),
      );
      return;
    }
    if (!TERMINAL_DELIVERY_EVENTS.has(event.type)) return;
    const delivery = getDb().prepare(`
      SELECT conversation_id,status FROM autonomous_delivery_run WHERE id=?
    `).get(event.aggregate.id) as { conversation_id: string; status: string } | undefined;
    if (
      !delivery
      || delivery.conversation_id !== event.projectId
      || !['completed', 'failed', 'cancelled'].includes(delivery.status)
    ) return;
    this.reconcileDelivery(
      event.projectId,
      event.aggregate.id,
      event.correlationId,
      event.eventId,
      new Date(event.recordedAt),
    );
  };

  private reconcileTask(
    projectId: string,
    taskId: string,
    correlationId: string,
    causationId: string,
    now: Date,
  ): number {
    const existing = this.contracts.listCurrentTaskScopedWorkIds(projectId, taskId);
    const closed = this.contracts.closeActiveTaskScoped({
      projectId, taskId, correlationId, causationId, now,
    });
    this.collaboration.cancel({
      kind: 'work',
      projectId,
      workIds: [...new Set([...existing, ...closed.map((authority) => authority.work_id)])],
      reasonCode: 'task_owner_terminal',
    });
    this.collaboration.cancel({ kind: 'task', projectId, taskId, includeClaimed: true });
    return closed.length;
  }

  private reconcileFailedInvocation(
    invocation: InvocationRow,
    causationId: string,
    now: Date,
  ): boolean {
    if (
      invocation.status !== 'terminated'
      || invocation.outcome === 'completed'
      || !invocation.work_id
    ) return false;
    const authority = this.contracts.getAuthority(invocation.work_id);
    if (!authority || authority.status !== 'active') return false;
    const contract = getDb().prepare(`
      SELECT attempt_id FROM work_contract WHERE id=?
    `).get(authority.current_contract_id) as { attempt_id: string } | undefined;
    if (!contract || contract.attempt_id !== invocation.id) return false;
    return this.closeWork(
      invocation.conversation_id,
      invocation.work_id,
      invocation.id,
      causationId,
      now,
      invocation.reason_code ?? 'invocation_failed',
    );
  }

  private closeWork(
    projectId: string,
    workId: string,
    correlationId: string,
    causationId: string,
    now: Date,
    reasonCode: string,
  ): boolean {
    const authority = this.contracts.getAuthority(workId);
    if (!authority || authority.status !== 'active' || authority.project_id !== projectId) return false;
    this.contracts.close({
      workId,
      expectedEpoch: authority.current_epoch,
      correlationId,
      causationId,
      now,
    });
    this.collaboration.cancel({ kind: 'work', projectId, workIds: [workId], reasonCode });
    return true;
  }

  private reconcileDelivery(
    projectId: string,
    deliveryRunId: string,
    correlationId: string,
    causationId: string,
    now: Date,
  ): void {
    const existing = this.contracts.listCurrentDeliveryWorkIds(projectId, deliveryRunId);
    const closed = this.contracts.closeActiveForDelivery({
      projectId, deliveryRunId, correlationId, causationId, now,
    });
    this.collaboration.cancel({
      kind: 'work',
      projectId,
      workIds: [...new Set([...existing, ...closed.map((authority) => authority.work_id)])],
      reasonCode: 'delivery_owner_terminal',
    });
    this.collaboration.cancel({ kind: 'delivery', projectId, deliveryRunId });
  }
}
