interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
}

interface TaskInfo {
  id: string;
  title: string;
  agentId: string;
  status: 'pending' | 'in_progress' | 'done';
}

const STATUS_LABELS: Record<string, string> = {
  done: '✓',
  in_progress: '进行中',
  pending: '待处理',
};

export function buildProjectStatusLayer(
  agents: AgentInfo[],
  tasks: TaskInfo[],
): string {
  if (tasks.length === 0) return '';

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const pending = tasks.filter((t) => t.status === 'pending').length;

  // Group tasks by agent
  const byAgent = new Map<string, TaskInfo[]>();
  const unassigned: TaskInfo[] = [];

  for (const task of tasks) {
    if (!task.agentId) {
      unassigned.push(task);
    } else {
      const list = byAgent.get(task.agentId) ?? [];
      list.push(task);
      byAgent.set(task.agentId, list);
    }
  }

  const lines: string[] = [
    `## 项目任务看板`,
    '',
    `总进度：${total} 个任务 | ${done} 完成 | ${inProgress} 进行中 | ${pending} 待处理`,
    '',
  ];

  // Agent sections — in roster order
  for (const agent of agents) {
    const agentTasks = byAgent.get(agent.id);
    if (!agentTasks || agentTasks.length === 0) {
      lines.push(`${agent.emoji} ${agent.name}: 无任务`);
    } else {
      const taskLines = agentTasks
        .map((t) => `${t.id} ${STATUS_LABELS[t.status]} ${t.title}`)
        .join(', ');
      lines.push(`${agent.emoji} ${agent.name}: ${taskLines}`);
    }
  }

  // Unassigned section
  if (unassigned.length > 0) {
    const unassignedLines = unassigned
      .map((t) => `${t.id} ${STATUS_LABELS[t.status]} ${t.title}`)
      .join(', ');
    lines.push(`未分配: ${unassignedLines}`);
  }

  return lines.join('\n');
}
