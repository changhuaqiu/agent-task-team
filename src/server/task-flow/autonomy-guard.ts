import type { ExecutionEnvelopeRow } from '../repositories/execution-envelope-repo';
import type { InvocationRow } from '../repositories/invocation-repo';
import type { TaskRow } from '../repositories/task-repo';
import type { TaskEdgeRow } from '../repositories/task-graph-repo';
import type { TaskWakeup } from './task-wakeup';
import type { TaskWakeupReasonCode, TaskWakeupDispatchSource } from './task-wakeup';

export interface ResolveAutonomyGuardWakeupsInput {
  tasks: TaskRow[];
  envelopes: ExecutionEnvelopeRow[];
  invocations?: InvocationRow[];
  pendingTaskDispatchIds?: string[];
  coordinatorAgentIds: string[];
  reviewAgentIds: string[];
  qaAgentIds: string[];
  edges?: TaskEdgeRow[];
  closureDispatchedRootTaskIds?: string[];
  now?: Date;
  staleMs?: number;
  maxAttemptsPerTaskAgent?: number;
  retryBudgetEscalationAvailable?: boolean;
  attemptWindowStartedAt?: string;
  reviewableTaskIds?: string[];
}

export interface AutonomyGuardEscalation {
  conversationId: string;
  taskId: string;
  taskStatus: string;
  agentId: string;
  attempts: number;
  lastReasonCode?: string;
}

export interface AutonomyGuardActions {
  wakeups: TaskWakeup[];
  escalations: AutonomyGuardEscalation[];
}

const ACTIVE_ENVELOPE_STATUSES = new Set(['drafted', 'validated', 'routed', 'sent']);

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

function hasActiveDispatch(
  taskId: string,
  envelopes: ExecutionEnvelopeRow[],
  invocations: InvocationRow[],
  pendingTaskDispatchIds: ReadonlySet<string>,
): boolean {
  return pendingTaskDispatchIds.has(taskId) || envelopes.some((envelope) =>
    envelope.task_id === taskId && ACTIVE_ENVELOPE_STATUSES.has(envelope.status)
  ) || invocations.some((invocation) =>
    invocation.task_id === taskId && invocation.status !== 'terminated'
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

export function resolveAutonomyGuardActions(input: ResolveAutonomyGuardWakeupsInput): AutonomyGuardActions {
  const now = input.now ?? new Date();
  const staleMs = input.staleMs ?? 30 * 60 * 1000;
  const tasksById = new Map(input.tasks.map((task) => [task.id, task]));
  const wakeups: TaskWakeup[] = [];
  const escalations: AutonomyGuardEscalation[] = [];
  const maxAttempts = Math.max(1, input.maxAttemptsPerTaskAgent ?? 3);
  const terminalTaskStatuses = new Set(['done', 'cancelled']);
  const subtaskEdges = (input.edges ?? []).filter((edge) => edge.type === 'subtask_of');
  const childrenByParent = new Map<string, string[]>();
  const childIds = new Set<string>();
  for (const edge of subtaskEdges) {
    childrenByParent.set(edge.to_task_id, [...(childrenByParent.get(edge.to_task_id) ?? []), edge.from_task_id]);
    childIds.add(edge.from_task_id);
  }
  const dispatchedRoots = new Set(input.closureDispatchedRootTaskIds ?? []);
  const reviewableTaskIds = input.reviewableTaskIds
    ? new Set(input.reviewableTaskIds)
    : undefined;
  const pendingTaskDispatchIds = new Set(input.pendingTaskDispatchIds ?? []);
  const closureRootIds = new Set<string>();
  const pushOnce = (wakeup: TaskWakeup) => {
    if (wakeups.some((item) => item.metadata.idempotencyKey === wakeup.metadata.idempotencyKey)) return;
    wakeups.push(wakeup);
  };
  const retryBudgetExhausted = (task: TaskRow, agentId: string): boolean => {
    if (!input.retryBudgetEscalationAvailable) return false;
    const taskUpdatedAt = new Date(task.updated_at).getTime();
    const recoveryStartedAt = input.attemptWindowStartedAt
      ? new Date(input.attemptWindowStartedAt).getTime()
      : 0;
    const attemptWindowStartedAt = Math.max(taskUpdatedAt, recoveryStartedAt);
    const failures = (input.invocations ?? [])
      .filter((invocation) =>
        invocation.task_id === task.id
        && invocation.agent_id === agentId
        && invocation.status === 'terminated'
        && (invocation.outcome === 'failed' || invocation.outcome === 'timed_out')
        && new Date(invocation.created_at).getTime() >= attemptWindowStartedAt
      )
      .sort((left, right) => left.created_at.localeCompare(right.created_at));
    if (failures.length < maxAttempts) return false;
    if (!escalations.some((item) => item.taskId === task.id && item.agentId === agentId)) {
      escalations.push({
        conversationId: task.conversation_id,
        taskId: task.id,
        taskStatus: task.status,
        agentId,
        attempts: failures.length,
        lastReasonCode: failures.at(-1)?.reason_code ?? undefined,
      });
    }
    return true;
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

  for (const root of input.tasks) {
    if (!childrenByParent.has(root.id) || childIds.has(root.id)) continue;
    if (terminalTaskStatuses.has(root.status) || dispatchedRoots.has(root.id)) continue;
    const descendants = collectDescendants(root.id);
    if (descendants.length === 0 || !descendants.every((task) => terminalTaskStatuses.has(task.status))) continue;
    const agentId = input.coordinatorAgentIds.includes(root.agent_id)
      ? root.agent_id
      : input.coordinatorAgentIds[0] ?? root.agent_id;
    if (!agentId) continue;
    const partial = descendants.some((task) => task.status === 'cancelled');
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
    if (closureRootIds.has(task.id)) continue;
    const updatedAt = task.updated_at ? new Date(task.updated_at).getTime() : 0;
    const isStale = updatedAt > 0 && now.getTime() - updatedAt >= staleMs;
    const activeDispatch = hasActiveDispatch(
      task.id,
      input.envelopes,
      input.invocations ?? [],
      pendingTaskDispatchIds,
    );

    if (task.status === 'ready' && task.agent_id && dependenciesSatisfied(task, tasksById) && !activeDispatch) {
      if (retryBudgetExhausted(task, task.agent_id)) continue;
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

    if (task.status === 'in_progress' && task.agent_id && isStale && !activeDispatch) {
      if (retryBudgetExhausted(task, task.agent_id)) continue;
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

    if (
      task.status === 'in_review'
      && isStale
      && !activeDispatch
      && (!reviewableTaskIds || reviewableTaskIds.has(task.id))
    ) {
      for (const reviewAgentId of input.reviewAgentIds) {
        if (retryBudgetExhausted(task, reviewAgentId)) continue;
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

  }

  return { wakeups, escalations };
}

export function resolveAutonomyGuardWakeups(input: ResolveAutonomyGuardWakeupsInput): TaskWakeup[] {
  return resolveAutonomyGuardActions(input).wakeups;
}
