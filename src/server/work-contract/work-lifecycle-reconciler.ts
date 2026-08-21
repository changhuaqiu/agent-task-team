import { getDb } from '../db';
import { AgentInbox } from '../platform-events/agent-inbox';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { WorkContractRepository } from './repository';
import type { AgentWorkCommand } from '../platform-events/agent-inbox';
import { parseWorkIdentity } from './work-identity';

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
    if (event.type === 'agent.work.enqueued') {
      if (!event.inboxItemId) return;
      const row = getDb().prepare(`
        SELECT command_json FROM agent_inbox_item WHERE id=? AND project_id=?
      `).get(event.inboxItemId, event.projectId) as { command_json: string } | undefined;
      if (!row) return;
      const command = JSON.parse(row.command_json) as AgentWorkCommand;
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
  ): void {
    const existing = this.contracts.listCurrentTaskScopedWorkIds(projectId, taskId);
    const closed = this.contracts.closeActiveTaskScoped({
      projectId, taskId, correlationId, causationId, now,
    });
    this.inbox.cancelPendingForWorkIds(
      projectId,
      [...new Set([...existing, ...closed.map((authority) => authority.work_id)])],
      'task_owner_terminal',
    );
    this.inbox.cancelForTerminalTask(projectId, taskId);
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
    this.inbox.cancelPendingForWorkIds(
      projectId,
      [...new Set([...existing, ...closed.map((authority) => authority.work_id)])],
      'delivery_owner_terminal',
    );
    this.inbox.cancelForTerminalDelivery(projectId, deliveryRunId);
  }
}
