// Invocation Pipeline outcome reduction.
import type { Server as IOServer } from 'socket.io';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskRepo } from '../repositories/task-repo';
import {
  stableTaskCommandKey,
  taskCommandService,
} from '../repositories/task-command-service';
import { updateTaskInMd } from '../task-file-service';
import type { TaskWakeupReasonCode } from '../task-flow/task-wakeup';
import { publishProjectView } from '../project-view/project-view-publisher';

export const PROJECTION_ERROR_MESSAGE_LIMIT = 512;

export function sanitizeProjectionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n\t]+/g, ' ').slice(0, PROJECTION_ERROR_MESSAGE_LIMIT);
}

/**
 * Runtime acceptance is execution evidence, not review/delivery evidence. The
 * only automatic business transition is ready -> in_progress for a ready
 * owner. All quality-gate transitions still require structured task tools.
 */
export interface AcceptedTaskWakeup {
  id?: string;
  conversationId: string;
  taskId: string;
  agentId: string;
  reasonCode: TaskWakeupReasonCode;
  metadata: { idempotencyKey: string };
}

export async function reduceAcceptedWakeup(
  io: IOServer,
  wakeup: AcceptedTaskWakeup,
): Promise<void> {
  if (wakeup.reasonCode !== 'owner_ready' && wakeup.reasonCode !== 'dependency_resolved') return;
  const previousTask = taskRepo.getById(wakeup.taskId);
  if (!previousTask || previousTask.status !== 'ready' || previousTask.agent_id !== wakeup.agentId) return;

  const idempotencyKey = wakeup.id
    ? `task-wakeup:${wakeup.id}:start`
    : stableTaskCommandKey('task-wakeup:start', wakeup);
  const task = taskCommandService.transition({
    conversationId: previousTask.conversation_id,
    taskId: previousTask.id,
    expectedTaskRevision: previousTask.revision,
    expectedGraphRevision: taskCommandService.expectedGraphRevision(
      previousTask.conversation_id,
      idempotencyKey,
    ),
    idempotencyKey,
    actor: { type: 'system', id: 'platform-harness' },
    causationId: wakeup.id,
    to: 'in_progress',
  }).result.task;
  let projected = false;
  let projectionFailureCause = task.work_dir ? 'task_entry_missing' : 'work_dir_missing';
  let projectionErrorMessage: string | undefined;
  if (task.work_dir) {
    try {
      projected = updateTaskInMd(
        task.work_dir,
        task.conversation_id,
        wakeup.taskId,
        { status: 'in_progress' },
      );
    } catch (error) {
      projectionFailureCause = 'io_error';
      projectionErrorMessage = sanitizeProjectionErrorMessage(error);
    }
  }
  if (!projected) {
    proofLogRepo.append({
      eventType: 'task_graph.runtime_projection.failed',
      conversationId: wakeup.conversationId,
      taskId: wakeup.taskId,
      agentId: wakeup.agentId,
      actorId: 'platform-harness',
      reasonCode: 'runtime_projection_failed',
      metadata: {
        taskProjectDir: task.work_dir,
        status: 'in_progress',
        failureCause: projectionFailureCause,
        ...(projectionErrorMessage ? { errorMessage: projectionErrorMessage } : {}),
      },
    });
    publishProjectView(io, wakeup.conversationId, {
      type: 'task.sync_error',
      delivery: 'durable',
      actor: { type: 'system', id: 'invocation-outcome-reducer' },
      subject: { type: 'task', id: wakeup.taskId },
      correlationId: wakeup.metadata.idempotencyKey,
      causationId: wakeup.metadata.idempotencyKey,
      payload: {
        conversationId: wakeup.conversationId,
        taskId: wakeup.taskId,
        reasonCode: 'runtime_projection_failed',
        message: 'Task dispatch was accepted, but the runtime TASKS.md projection needs reconciliation.',
      },
    });
  }
  proofLogRepo.append({
    eventType: 'invocation.task.started',
    conversationId: wakeup.conversationId,
    taskId: wakeup.taskId,
    agentId: wakeup.agentId,
    actorId: 'platform-harness',
    metadata: { reasonCode: wakeup.reasonCode },
  });

  const { publishTaskChangeNotification } = await import('../task-flow/task-notification-publisher');
  publishTaskChangeNotification({
    io,
    kind: 'task.status_changed',
    task,
    previousTask,
    actorId: 'platform-harness',
    actorType: 'system',
    changedFields: ['status'],
  });
}
