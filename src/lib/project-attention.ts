import type { Blocker } from '@/store/taskHubStore';
import type { ProjectWorkItem } from './project-work-items';

export interface ProjectAttentionItem {
  id: string;
  conversationId: string;
  taskId: string;
  title: string;
  reason: string;
  updatedAt: string;
  source: 'task' | 'blocker';
}

/** Read-only, current facts. Historical handoffs and ACKs are not attention. */
export function projectAttention(
  items: ProjectWorkItem[],
  blockers: Blocker[] = [],
): ProjectAttentionItem[] {
  const attention = new Map<string, ProjectAttentionItem>();
  for (const item of items) for (const task of item.tasks) {
    if (task.status !== 'blocked') continue;
    const key = JSON.stringify([task.conversationId, task.id]);
    attention.set(key, {
      id: key, conversationId: task.conversationId, taskId: task.id,
      title: task.title, reason: task.reviewNote || '任务暂时无法继续，请查看执行记录与恢复条件。',
      updatedAt: task.updatedAt, source: 'task',
    });
  }
  for (const blocker of blockers) {
    if (blocker.status !== 'open') continue;
    const key = JSON.stringify([blocker.conversationId, blocker.taskId]);
    const current = attention.get(key);
    if (current) {
      attention.set(key, { ...current, reason: blocker.reasonSummary || current.reason });
      continue;
    }
    // Automated gate failures on tasks that have since advanced are historical;
    // a still-open manual decision must remain visible until its owner resolves it.
    const task = items.flatMap((item) => item.tasks).find((candidate) =>
      candidate.conversationId === blocker.conversationId && candidate.id === blocker.taskId);
    if (blocker.type !== 'manual' && task && task.status !== 'blocked') continue;
    attention.set(key, {
      id: key, conversationId: blocker.conversationId, taskId: blocker.taskId,
      title: task?.title ?? '项目待处理事项', reason: blocker.reasonSummary,
      updatedAt: blocker.createdAt, source: 'blocker',
    });
  }
  return [...attention.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
