import { getDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { WorkContractRepository } from './repository';

const TERMINAL_TASK_EVENTS = new Set(['task.done', 'task.cancelled']);
const TERMINAL_DELIVERY_EVENTS = new Set([
  'delivery.run.completed',
  'delivery.run.failed',
  'delivery.run.cancelled',
]);

export interface WorkLifecycleReconcilerOptions {
  inbox?: AgentInbox;
  contracts?: WorkContractRepository;
}

/**
 * Reclaims runtime-side Work once its Task or Delivery owner is terminal.
 * Historical terminal events are safe to replay because authority close and
 * Inbox cancellation are both idempotent and current owner state is re-read.
 */
export class WorkLifecycleReconciler {
  private readonly inbox: AgentInbox;
  private readonly contracts: WorkContractRepository;

  constructor(options: WorkLifecycleReconcilerOptions = {}) {
    this.inbox = options.inbox ?? new AgentInbox();
    this.contracts = options.contracts ?? new WorkContractRepository();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (signal.aborted) throw signal.reason ?? new Error('work_lifecycle_reconcile_aborted');
    if (TERMINAL_TASK_EVENTS.has(event.type)) {
      const task = getDb().prepare(`
        SELECT conversation_id,status FROM task WHERE id=?
      `).get(event.aggregate.id) as { conversation_id: string; status: string } | undefined;
      if (
        !task
        || task.conversation_id !== event.projectId
        || !['done', 'cancelled'].includes(task.status)
      ) return;
      const workIds = this.contracts.listCurrentTaskScopedWorkIds(
        event.projectId,
        event.aggregate.id,
      );
      this.contracts.closeActiveTaskScoped({
        projectId: event.projectId,
        taskId: event.aggregate.id,
        correlationId: event.correlationId,
        causationId: event.eventId,
        now: new Date(event.recordedAt),
      });
      this.inbox.cancelPendingForWorkIds(
        event.projectId,
        workIds,
        'task_owner_terminal',
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
    const workIds = this.contracts.listCurrentDeliveryWorkIds(
      event.projectId,
      event.aggregate.id,
    );
    this.contracts.closeActiveForDelivery({
      projectId: event.projectId,
      deliveryRunId: event.aggregate.id,
      correlationId: event.correlationId,
      causationId: event.eventId,
      now: new Date(event.recordedAt),
    });
    this.inbox.cancelPendingForWorkIds(
      event.projectId,
      workIds,
      'delivery_owner_terminal',
    );
  };
}
