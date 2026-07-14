import type { Server as IOServer } from 'socket.io';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskRepo } from '../repositories/task-repo';
import type { TaskWakeup } from '../task-flow/task-wakeup';

/**
 * Runtime acceptance is execution evidence, not review/delivery evidence. The
 * only automatic business transition is pending -> in_progress for a ready
 * owner. All quality-gate transitions still require structured task tools.
 */
export async function reduceAcceptedWakeup(io: IOServer, wakeup: TaskWakeup): Promise<void> {
  if (wakeup.reasonCode !== 'owner_ready' && wakeup.reasonCode !== 'dependency_resolved') return;
  const previousTask = taskRepo.getById(wakeup.taskId);
  if (!previousTask || previousTask.status !== 'pending' || previousTask.agent_id !== wakeup.agentId) return;

  taskRepo.updateStatus(wakeup.taskId, 'in_progress');
  const task = taskRepo.getById(wakeup.taskId);
  if (!task) return;
  proofLogRepo.append({
    eventType: 'harness.task.started',
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
