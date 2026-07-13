export function buildTaskContextLayer(
  task: {
    id: string;
    title: string;
    description?: string;
    phase?: { title: string };
    conversationId?: string;
  },
  projectId?: string
): string {
  // 作用域断言：只有当 conversationId 有明确值（非空、非undefined）且不同于 projectId 时才抛错
  if (projectId && task.conversationId && task.conversationId.trim() && task.conversationId !== projectId) {
    throw new Error(
      `Task ${task.id} belongs to project ${task.conversationId}, but expected ${projectId}`
    );
  }

  const parts: string[] = [`[任务: ${task.id} ${task.title}]`];
  if (task.phase) {
    parts.push(`[阶段: ${task.phase.title}]`);
  }
  if (task.description) {
    parts.push(task.description);
  }
  return parts.join('\n');
}
