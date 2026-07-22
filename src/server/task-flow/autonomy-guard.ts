import type { ExecutionEnvelopeRow } from '../repositories/execution-envelope-repo';
import type { TaskRow } from '../repositories/task-repo';
import type { TaskEdgeRow } from '../repositories/task-graph-repo';
import type { TaskWakeup } from './task-wakeup';
import type { TaskWakeupReasonCode, TaskWakeupDispatchSource } from './task-wakeup';

export interface ResolveAutonomyGuardWakeupsInput {
  tasks: TaskRow[];
  envelopes: ExecutionEnvelopeRow[];
  coordinatorAgentIds: string[];
  reviewAgentIds: string[];
  qaAgentIds: string[];
  edges?: TaskEdgeRow[];
  closureDispatchedRootTaskIds?: string[];
  deliveryControlledTaskIds?: string[];
  deliveryControlledRootTaskIds?: string[];
  suspendedDeliveryRootTaskIds?: string[];
  now?: Date;
  staleMs?: number;
}

const TERMINAL_ENVELOPE_STATUSES = new Set(['completed', 'failed', 'blocked', 'expired']);

function parseDependencyIds(task: TaskRow): string[] {
  if (!task.dependencies) return [];
  try {
    const parsed = JSON.parse(task.dependencies);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return task.dependencies.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function dependenciesSatisfied(task: TaskRow, tasksById: Map<string, TaskRow>): boolean {
  return parseDependencyIds(task).every((id) => tasksById.get(id)?.status === 'done');
}

function hasActiveDispatch(taskId: string, envelopes: ExecutionEnvelopeRow[]): boolean {
  return envelopes.some((envelope) =>
    envelope.task_id === taskId && !TERMINAL_ENVELOPE_STATUSES.has(envelope.status)
  );
}

function makeWakeup(input: {
  task: TaskRow;
  agentId: string;
  reasonCode: TaskWakeupReasonCode;
  dispatchSource: TaskWakeupDispatchSource;
  prompt: string;
  content: string;
  metadata?: Pick<TaskWakeup['metadata'], 'reasonSummary' | 'rootTaskId' | 'subtreeSize' | 'partial'>;
}): TaskWakeup {
  return {
    conversationId: input.task.conversation_id,
    taskId: input.task.id,
    agentId: input.agentId,
    reasonCode: input.reasonCode,
    dispatchSource: input.dispatchSource,
    prompt: input.prompt,
    content: input.content,
    metadata: {
      taskId: input.task.id,
      taskTitle: input.task.title,
      taskStatus: input.task.status,
      ownerAgentId: input.task.agent_id,
      reasonCode: input.reasonCode,
      idempotencyKey: `${input.task.conversation_id}:${input.task.id}:${input.agentId}:${input.reasonCode}`,
      startsA2AHandoff: false,
      startsDispatch: true,
      ...input.metadata,
    },
  };
}

export function resolveAutonomyGuardWakeups(input: ResolveAutonomyGuardWakeupsInput): TaskWakeup[] {
  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? 30 * 60 * 1000;
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const wakeups: TaskWakeup[] = [];
  const terminalTaskStatuses = new Set(['done', 'abandoned', 'cancelled']);
  const deliveryControlledRootTaskIds = new Set(input.deliveryControlledRootTaskIds ?? []);
  const subtaskEdges = (input.edges ?? []).filter((edge) => edge.type === 'subtask_of');
  const childrenByParent = new Map<string, string[]>();
  const childIds = new Set<string>();
  for (const edge of subtaskEdges) {
    childrenByParent.set(edge.to_task_id, [...(childrenByParent.get(edge.to_task_id) ?? []), edge.from_task_id]);
    childIds.add(edge.from_task_id);
  }
  const dispatchedRoots = new Set(input.closureDispatchedRootTaskIds ?? []);
  const closureRootIds = new Set<string>();
  const pushOnce = (wakeup: TaskWakeup) => {
    if (wakeups.some((item) => item.metadata.idempotencyKey === wakeup.metadata.idempotencyKey)) return;
    wakeups.push(wakeup);
  };

  const collectDescendants = (rootTaskId: string): TaskRow[] => {
    const descendants: TaskRow[] = [];
    const seen = new Set<string>();
    const stack = [...(childrenByParent.get(rootTaskId) ?? [])];
    while (stack.length > 0) {
      const taskId = stack.pop()!;
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      const task = tasksById.get(taskId);
      if (task) descendants.push(task);
      stack.push(...(childrenByParent.get(taskId) ?? []));
    }
    return descendants;
  };

  const deliveryControlledTaskIds = new Set(input.deliveryControlledTaskIds ?? []);
  for (const rootTaskId of deliveryControlledRootTaskIds) {
    deliveryControlledTaskIds.add(rootTaskId);
    for (const descendant of collectDescendants(rootTaskId)) {
      deliveryControlledTaskIds.add(descendant.id);
    }
  }

  for (const root of input.tasks) {
    if (!childrenByParent.has(root.id) || childIds.has(root.id)) continue;
    if (deliveryControlledTaskIds.has(root.id)) continue;
    if (terminalTaskStatuses.has(root.status) || dispatchedRoots.has(root.id)) continue;
    const descendants = collectDescendants(root.id);
    if (descendants.length === 0 || !descendants.every((task) => terminalTaskStatuses.has(task.status))) continue;
    const agentId = input.coordinatorAgentIds.includes(root.agent_id)
      ? root.agent_id
      : input.coordinatorAgentIds[0] ?? root.agent_id;
    if (!agentId) continue;
    const partial = descendants.some((task) => task.status === 'abandoned' || task.status === 'cancelled');
    closureRootIds.add(root.id);
    pushOnce(makeWakeup({
      task: root,
      agentId,
      reasonCode: 'chain_ready_for_closure',
      dispatchSource: 'system',
      prompt: `根任务 ${root.id}: ${root.title} 的 ${descendants.length} 个后代任务已全部进入终态，请输出 Closure Report。`,
      content: `系统唤醒 @${agentId}：任务链已可收敛，请完成根任务「${root.title}」的闭环报告。`,
      metadata: {
        reasonSummary: '根任务的全部后代任务已进入终态',
        rootTaskId: root.id,
        subtreeSize: descendants.length,
        partial,
      },
    }));
  }

  for (const task of input.tasks) {
    if (deliveryControlledTaskIds.has(task.id)) continue;
    if (closureRootIds.has(task.id)) continue;
    const updatedAt = task.updated_at ? new Date(task.updated_at).getTime() : 0;
    const isStale = updatedAt > 0 && now.getTime() - updatedAt >= staleMs;
    const activeDispatch = hasActiveDispatch(task.id, input.envelopes);

    if (task.status === 'pending' && task.agent_id && dependenciesSatisfied(task, tasksById) && !activeDispatch) {
      pushOnce(makeWakeup({
        task,
        agentId: task.agent_id,
        reasonCode: 'owner_ready',
        dispatchSource: 'workflow',
        prompt: `任务已可执行但没有活跃派发，请开始执行 ${task.id}: ${task.title}. ${task.description ?? ''}`.trim(),
        content: `系统轻推 @${task.agent_id}：${task.id}「${task.title}」已可执行但没有活跃派发。`,
      }));
      continue;
    }

    if (
      task.status === 'in_progress'
      && task.agent_id
      && isStale
      && !activeDispatch
    ) {
      pushOnce(makeWakeup({
        task,
        agentId: task.agent_id,
        reasonCode: 'runnable_owned_idle',
        dispatchSource: 'system',
        prompt: `任务可继续但没有活跃派发，请恢复执行或说明阻塞 ${task.id}: ${task.title}. ${task.description ?? ''}`.trim(),
        content: `系统轻推 @${task.agent_id}：${task.id}「${task.title}」可继续但没有活跃派发。`,
      }));
      continue;
    }

    if (task.status === 'in_review' && isStale && !activeDispatch) {
      for (const reviewAgentId of input.reviewAgentIds) {
        pushOnce(makeWakeup({
          task,
          agentId: reviewAgentId,
          reasonCode: 'stale_review_gate',
          dispatchSource: 'review_gate',
          prompt: `review_gate 已停滞，请评审、退回或升级 ${task.id}: ${task.title}. ${task.description ?? ''}`.trim(),
          content: `系统轻推 @${reviewAgentId}：${task.id}「${task.title}」review_gate 已停滞。`,
        }));
      }
      continue;
    }

    if (task.status === 'test_gate' && isStale && !activeDispatch) {
      for (const qaAgentId of input.qaAgentIds) {
        pushOnce(makeWakeup({
          task,
          agentId: qaAgentId,
          reasonCode: 'stale_test_gate',
          dispatchSource: 'test_gate',
          prompt: `test_gate 已停滞，请测试、退回或升级 ${task.id}: ${task.title}. ${task.description ?? ''}`.trim(),
          content: `系统轻推 @${qaAgentId}：${task.id}「${task.title}」test_gate 已停滞。`,
        }));
      }
    }
  }

  return wakeups;
}
