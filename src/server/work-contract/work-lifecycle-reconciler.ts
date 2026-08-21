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
      if (!command.workId) return;
      const owner = getDb().prepare(`
        SELECT contract.task_id,contract.delivery_run_id,
               task.status AS task_status,delivery.status AS delivery_status
        FROM work_authority authority
        JOIN work_contract contract ON contract.id=authority.current_contract_id
        LEFT JOIN task ON task.id=contract.task_id
        LEFT JOIN autonomous_delivery_run delivery ON delivery.id=contract.delivery_run_id
        WHERE authority.work_id=? AND authority.project_id=?
      `).get(command.workId, event.projectId) as {
        task_id: string | null;
        delivery_run_id: string | null;
        task_status: string | null;
        delivery_status: string | null;
      } | undefined;
      if (!owner) return;
      if (
        owner.delivery_run_id
        && owner.delivery_status
        && ['completed', 'failed', 'cancelled'].includes(owner.delivery_status)
      ) {
        this.reconcileDelivery(
          event.projectId,
          owner.delivery_run_id,
          event.correlationId,
          event.eventId,
          new Date(event.recordedAt),
        );
        return;
      }
      const identity = parseWorkIdentity(command.workId);
      if (
        owner.task_id
        && identity?.scope === 'task'
        && identity.targetId === owner.task_id
        && owner.task_status
        && ['done', 'cancelled'].includes(owner.task_status)
      ) {
        this.reconcileTask(
          event.projectId,
          owner.task_id,
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
  }
}
