interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
}

interface TaskInfo {
  id: string;
  title: string;
  agentId: string;
  status: TaskStatus;
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: '待确认',
  ready: '待处理',
  done: '✓',
  in_progress: '进行中',
  blocked: '阻塞',
  in_review: '评审中',
  cancelled: '已取消',
};

export function buildProjectStatusLayer(
  agents: AgentInfo[],
  tasks: TaskInfo[],
): string {
  if (tasks.length === 0) return '';

  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const ready = tasks.filter((t) => t.status === 'proposed' || t.status === 'ready').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const inReview = tasks.filter((t) => t.status === 'in_review').length;

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
    `总进度：${total} 个任务 | ${done} 完成 | ${inProgress} 进行中 | ${inReview} 评审中 | ${ready} 待处理 | ${blocked} 阻塞`,
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
import type { TaskStatus } from '@/shared/task-status';
