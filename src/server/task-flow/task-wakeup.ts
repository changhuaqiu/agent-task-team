import type { TaskEdgeRow } from '../repositories/task-graph-repo';
import type { TaskRow } from '../repositories/task-repo';

export type TaskWakeupReasonCode =
  | 'owner_ready'
  | 'review_requested'
  | 'review_decision_ready'
  | 'test_requested'
  | 'dependency_resolved'
  | 'unblocked_unassigned'
  | 'missing_implementation_evidence'
  | 'missing_delivery_evidence'
  | 'stale_review_gate'
  | 'stale_test_gate'
  | 'runnable_owned_idle'
  | 'chain_ready_for_closure';
export type TaskWakeupDispatchSource = 'workflow' | 'review_gate' | 'test_gate' | 'system';

export interface ResolveTaskWakeupsInput {
  task: TaskRow;
  previousTask?: TaskRow;
  actorId?: string;
  changedFields?: string[];
  coordinatorAgentIds: string[];
  reviewAgentIds: string[];
  qaAgentIds?: string[];
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
    gateName?: string;
    missingFields?: string[];
    reasonSummary?: string;
    rootTaskId?: string;
    subtreeSize?: number;
    partial?: boolean;
  };
  createdAt?: string;
  /** Accepted server-side wakeups are rendered by clients but never dispatched twice. */
  handledByHarness?: boolean;
  harnessFallbackReasonCode?: string;
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

function isPassingReviewDecision(note: string | null | undefined): boolean {
  const text = note?.trim();
  if (!text) return false;
  if (/(不通过|未通过|拒绝|退回|阻塞|需修改|fail(?:ed)?|reject(?:ed)?|blocker)/i.test(text)) return false;
  return /(PASS|APPROVED|LGTM|通过|同意|无阻塞|可进入测试|可以测试)/i.test(text);
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
    : input.reasonCode === 'review_decision_ready'
      ? '请确认评审结论'
      : input.reasonCode === 'test_requested'
        ? '请开始测试'
        : input.reasonCode === 'unblocked_unassigned'
          ? '需要分配负责人'
          : input.reasonCode === 'missing_implementation_evidence'
            ? '请补齐实现证据'
            : input.reasonCode === 'missing_delivery_evidence'
              ? '请补齐交付证据'
              : input.reasonCode === 'stale_review_gate'
                ? 'review_gate 已停滞，请评审、退回或升级'
                : input.reasonCode === 'stale_test_gate'
                  ? 'test_gate 已停滞，请测试、退回或升级'
                  : input.reasonCode === 'runnable_owned_idle'
                    ? '任务可继续但没有活跃派发，请恢复执行或说明阻塞'
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

export function createGateEvidenceRecoveryWakeup(input: {
  task: TaskRow;
  agentId: string | null | undefined;
  reasonCode: 'missing_implementation_evidence' | 'missing_delivery_evidence';
  missingFields?: string[];
  gateName?: string;
}): TaskWakeup | undefined {
  const agentId = input.agentId?.trim();
  if (!agentId) return undefined;

  const wakeups: TaskWakeup[] = [];
  addWakeup(wakeups, {
    task: input.task,
    agentId,
    reasonCode: input.reasonCode,
    dispatchSource: 'system',
  });
  const wakeup = wakeups[0];
  if (!wakeup) return undefined;

  const fields = input.missingFields?.length ? `缺少字段：${input.missingFields.join(', ')}。` : '';
  const gate = input.gateName ? `${input.gateName} ` : '';
  return {
    ...wakeup,
    prompt: `${wakeup.prompt} ${gate}${fields}请补齐后重新提交结构化任务状态更新。`.trim(),
    content: `系统轻推 @${agentId}：${input.task.id}「${input.task.title}」${wakeup.metadata.reasonCode === 'missing_delivery_evidence' ? '缺少交付证据' : '缺少实现证据'}。${fields}`,
    metadata: {
      ...wakeup.metadata,
      gateName: input.gateName ?? '',
      missingFields: input.missingFields ?? [],
      idempotencyKey: `${input.task.conversation_id}:${input.task.id}:${agentId}:${input.reasonCode}:${(input.missingFields ?? []).join(',')}`,
    },
  };
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

  const reviewActorId = input.actorId && input.reviewAgentIds.includes(input.actorId)
    ? input.actorId
    : ((input.actorId === undefined || input.actorId === 'system') && input.reviewAgentIds.includes(input.task.agent_id)
      ? input.task.agent_id
      : undefined);
  const reviewActorSubmittedDecision =
    reviewActorId !== undefined &&
    input.task.status === 'in_review' &&
    (
      changedFields.includes('review_note') ||
      input.reviewAgentIds.includes(input.task.agent_id)
    );

  if (input.task.status === 'in_review' && changedFields.includes('status') && !reviewActorSubmittedDecision) {
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

  if (reviewActorSubmittedDecision) {
    for (const coordinatorAgentId of input.coordinatorAgentIds) {
      addWakeup(wakeups, {
        task: input.task,
        agentId: coordinatorAgentId,
        actorId: reviewActorId,
        reasonCode: 'review_decision_ready',
        dispatchSource: 'review_gate',
      });
    }

    if (isPassingReviewDecision(input.task.review_note)) {
      for (const qaAgentId of input.qaAgentIds ?? []) {
        addWakeup(wakeups, {
          task: input.task,
          agentId: qaAgentId,
          actorId: reviewActorId,
          reasonCode: 'test_requested',
          dispatchSource: 'test_gate',
        });
      }
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

  // When a task becomes done, check downstream tasks that have no owner but all deps satisfied.
  // Notify coordinators so they can assign an owner.
  if (input.previousTask && input.previousTask.status !== 'done' && input.task.status === 'done') {
    const tasksById = new Map(input.conversationTasks.map((task) => [task.id, task]));
    const downstreamNotified = new Set<string>();
    for (const edge of input.edges) {
      if (edge.type !== 'depends_on' || edge.from_task_id !== input.task.id) continue;
      const downstream = tasksById.get(edge.to_task_id);
      if (!downstream || downstream.status !== 'pending') continue;
      if (!dependenciesSatisfied(downstream, input.conversationTasks, input.edges)) continue;
      if (downstream.agent_id) continue; // has owner — handled by dependency_resolved above
      const key = downstream.id;
      if (downstreamNotified.has(key)) continue;
      downstreamNotified.add(key);
      for (const coordinatorAgentId of input.coordinatorAgentIds) {
        addWakeup(wakeups, {
          task: downstream,
          agentId: coordinatorAgentId,
          actorId: input.actorId,
          reasonCode: 'unblocked_unassigned',
          dispatchSource: 'workflow',
        });
      }
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
