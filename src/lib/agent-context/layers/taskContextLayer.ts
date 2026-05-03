export function buildTaskContextLayer(task: {
  id: string;
  title: string;
  description?: string;
  phase?: { title: string };
}): string {
  const parts: string[] = [`[任务: ${task.id} ${task.title}]`];
  if (task.phase) {
    parts.push(`[阶段: ${task.phase.title}]`);
  }
  if (task.description) {
    parts.push(task.description);
  }
  return parts.join('\n');
}
