import type { TaskEdgeRow } from '../repositories/task-graph-repo';
import type { TaskRow } from '../repositories/task-repo';

export type TaskWakeupReasonCode = 'owner_ready' | 'review_requested' | 'dependency_resolved';
export type TaskWakeupDispatchSource = 'workflow' | 'review_gate' | 'system';

export interface ResolveTaskWakeupsInput {
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  changedFields?: string[];
  reviewAgentIds: string[];
  conversationTasks: TaskRow[];
  edges: TaskEdgeRow[];
}

export interface TaskWakeup {
  id?: string;
  conversationId: string;
  taskId: string;
  agentId: string;
  reasonCode: TaskWakeupReasonCode;
  dispatchSource: TaskWakeupDispatchSource;
  prompt: string;
  content: string;
  metadata: {
    taskId: string;
    taskTitle: string;
    taskStatus: string;
    ownerAgentId: string;
    reasonCode: TaskWakeupReasonCode;
    idempotencyKey: string;
    startsA2AHandoff: false;
    startsDispatch: true;
  };
  createdAt?: string;
}

export interface TaskWakeupDeduper {
  shouldPublish(wakeup: TaskWakeup): boolean;
}

const DEFAULT_WAKEUP_DEDUPE_TTL_MS = 2 * 60 * 1000;

function parseDependencyIds(task: TaskRow, edges: TaskEdgeRow[]): string[] {
  const ids = new Set<string>();

  if (task.dependencies) {
    try {
      const parsed = JSON.parse(task.dependencies);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === 'string' && item.trim()) ids.add(item.trim());
        }
      }
    } catch {
      for (const item of task.dependencies.split(',')) {
        const trimmed = item.trim();
        if (trimmed) ids.add(trimmed);
      }
    }
  }

  for (const edge of edges) {
    if (edge.type === 'depends_on' && edge.to_task_id === task.id) {
      ids.add(edge.from_task_id);
    }
  }

  return Array.from(ids);
}

function dependenciesSatisfied(task: TaskRow, conversationTasks: TaskRow[], edges: TaskEdgeRow[]): boolean {
  const dependencyIds = parseDependencyIds(task, edges);
  if (dependencyIds.length === 0) return true;

  const tasksById = new Map(conversationTasks.map((item) => [item.id, item]));
  return dependencyIds.every((id) => tasksById.get(id)?.status === 'done');
}

function addWakeup(wakeups: TaskWakeup[], input: {
  task: TaskRow;
  agentId: string | null | undefined;
  actorId?: string;
  reasonCode: TaskWakeupReasonCode;
  dispatchSource: TaskWakeupDispatchSource;
}): void {
  const agentId = input.agentId?.trim();
  if (!agentId || agentId === input.actorId) return;
  if (wakeups.some((wakeup) => wakeup.taskId === input.task.id && wakeup.agentId === agentId && wakeup.reasonCode === input.reasonCode)) return;

  const actionText = input.reasonCode === 'review_requested'
    ? '请开始评审'
    : '请继续处理';
  const prompt = `${actionText} ${input.task.id}: ${input.task.title}. ${input.task.description ?? ''}`.trim();
  const idempotencyKey = `${input.task.conversation_id}:${input.task.id}:${agentId}:${input.reasonCode}`;

  wakeups.push({
    conversationId: input.task.conversation_id,
    taskId: input.task.id,
    agentId,
    reasonCode: input.reasonCode,
    dispatchSource: input.dispatchSource,
    prompt,
    content: `系统轻推 @${agentId}：${input.task.id}「${input.task.title}」${actionText}。这是 Wakeup 提醒，不是 A2A 交接。`,
    metadata: {
      taskId: input.task.id,
      taskTitle: input.task.title,
      taskStatus: input.task.status,
      ownerAgentId: input.task.agent_id,
      reasonCode: input.reasonCode,
      idempotencyKey,
      startsA2AHandoff: false,
      startsDispatch: true,
    },
  });
}

export function resolveTaskWakeups(input: ResolveTaskWakeupsInput): TaskWakeup[] {
  const changedFields = input.changedFields ?? [];
  const wakeups: TaskWakeup[] = [];
  const relevantOwnerChange =
    !input.previousTask ||
    changedFields.includes('status') ||
    changedFields.includes('agent_id') ||
    changedFields.includes('dependencies');

  if (
    input.task.status === 'pending' &&
    relevantOwnerChange &&
    dependenciesSatisfied(input.task, input.conversationTasks, input.edges)
  ) {
    addWakeup(wakeups, {
      task: input.task,
      agentId: input.task.agent_id,
      actorId: input.actorId,
      reasonCode: 'owner_ready',
      dispatchSource: 'workflow',
    });
  }

  if (input.task.status === 'in_review' && changedFields.includes('status')) {
    for (const reviewAgentId of input.reviewAgentIds) {
      addWakeup(wakeups, {
        task: input.task,
        agentId: reviewAgentId,
        actorId: input.actorId,
        reasonCode: 'review_requested',
        dispatchSource: 'review_gate',
      });
    }
  }

  if (input.previousTask && input.previousTask.status !== 'done' && input.task.status === 'done') {
    const tasksById = new Map(input.conversationTasks.map((task) => [task.id, task]));
    for (const edge of input.edges) {
      if (edge.type !== 'depends_on' || edge.from_task_id !== input.task.id) continue;
      const downstream = tasksById.get(edge.to_task_id);
      if (!downstream || downstream.status !== 'pending') continue;
      if (!dependenciesSatisfied(downstream, input.conversationTasks, input.edges)) continue;
      addWakeup(wakeups, {
        task: downstream,
        agentId: downstream.agent_id,
        actorId: input.actorId,
        reasonCode: 'dependency_resolved',
        dispatchSource: 'workflow',
      });
    }
  }

  return wakeups;
}

export function createTaskWakeupDeduper(ttlMs = DEFAULT_WAKEUP_DEDUPE_TTL_MS): TaskWakeupDeduper {
  const publishedAt = new Map<string, number>();

  return {
    shouldPublish(wakeup: TaskWakeup): boolean {
      const key = wakeup.metadata.idempotencyKey;
      const now = Date.now();
      for (const [existingKey, timestamp] of publishedAt) {
        if (now - timestamp > ttlMs) publishedAt.delete(existingKey);
      }
      const lastPublishedAt = publishedAt.get(key);
      if (lastPublishedAt !== undefined && now - lastPublishedAt <= ttlMs) {
        return false;
      }
      publishedAt.set(key, now);
      return true;
    },
  };
}
