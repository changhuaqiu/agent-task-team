import type { Server as IOServer } from 'socket.io';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { publishProjectView } from '../project-view/project-view-publisher';
import type { TaskWakeupReasonCode } from '../task-flow/task-wakeup';
import { reduceAcceptedWakeup } from './outcome-reducer';

const TASK_WAKEUP_REASONS: ReadonlySet<string> = new Set([
  'owner_ready',
  'review_requested',
  'review_decision_ready',
  'review_changes_requested',
  'test_requested',
  'dependency_resolved',
  'unblocked_unassigned',
  'missing_implementation_evidence',
  'missing_delivery_evidence',
  'stale_review_gate',
  'stale_test_gate',
  'runnable_owned_idle',
  'chain_ready_for_closure',
]);

export class TaskWorkLifecycleProcessManager {
  constructor(private readonly io: IOServer) {}

  readonly handle: PlatformEventHandler = async (event, { signal }) => {
    if (signal.aborted) throw signal.reason ?? new Error('task_work_lifecycle_aborted');
    if (event.type !== 'agent.work.admitted' && event.type !== 'agent.work.expired') return;
    const payload = event.payload as {
      taskId?: string;
      idempotencyKey?: string;
      reasonCode?: string;
      wakeup?: { reasonCode?: string };
    };
    const reasonCode = payload.wakeup?.reasonCode;
    if (
      !payload.taskId
      || !event.projectAgentId
      || !reasonCode
      || !TASK_WAKEUP_REASONS.has(reasonCode)
    ) return;
    const wakeup = {
      id: event.inboxItemId ?? event.aggregate.id,
      conversationId: event.projectId,
      taskId: payload.taskId,
      agentId: event.projectAgentId,
      reasonCode: reasonCode as TaskWakeupReasonCode,
      metadata: { idempotencyKey: payload.idempotencyKey ?? event.correlationId },
    };
    if (event.type === 'agent.work.admitted') {
      await reduceAcceptedWakeup(this.io, wakeup);
      return;
    }
    publishProjectView(this.io, event.projectId, {
      type: 'task.wakeup',
      delivery: 'durable',
      actor: { type: 'system', id: 'collaboration-kernel' },
      subject: { type: 'task', id: payload.taskId },
      eventId: `${event.eventId}:task-wakeup-failed`,
      correlationId: event.correlationId,
      causationId: event.eventId,
      occurredAt: event.recordedAt,
      payload: {
        id: event.inboxItemId ?? event.aggregate.id,
        conversationId: event.projectId,
        taskId: payload.taskId,
        agentId: event.projectAgentId,
        reasonCode,
        content: `服务端未能启动 @${event.projectAgentId}：${payload.reasonCode ?? 'runtime_start_failed'}`,
        metadata: {
          reasonCode,
          idempotencyKey: payload.idempotencyKey ?? event.correlationId,
          executionReasonCode: payload.reasonCode ?? 'runtime_start_failed',
        },
      },
    });
  };
}
