export interface TaskGraphTaskRow {
  id: string;
  conversation_id: string;
  title: string;
  status: string;
  agent_id: string;
  description?: string | null;
}

export interface TaskGraphEdgeRow {
  id: string;
  from_task_id: string;
  to_task_id: string;
  type: string;
  created_by_action_id?: string;
  created_at?: string;
}

export interface TaskGraphActionRow {
  id: string;
  actor_id: string;
  actor_type: string;
  type: string;
  task_ids: string;
  message_id?: string | null;
  pass_id?: string | null;
  proof_event_id?: string | null;
  payload: string;
  created_at: string;
}

export interface TaskGraphArtifactRow {
  id: string;
  task_id: string;
  kind: string;
  label: string;
  path?: string | null;
  url?: string | null;
  proof_event_id?: string | null;
  created_at?: string;
}

export interface TaskGraphBindingRow {
  id: string;
  message_id: string;
  task_id: string;
  action_id?: string | null;
  created_at: string;
}

export interface TaskGraphProofEventRow {
  id: string;
  event_type: string;
  task_id?: string | null;
  pass_id?: string | null;
  actor_id?: string | null;
  agent_id?: string | null;
  reason_code?: string | null;
  metadata?: string | null;
  created_at: string;
}

export interface TaskGraphApiView {
  conversationId: string;
  revision: number;
  tasks: TaskGraphTaskRow[];
  edges: TaskGraphEdgeRow[];
  actions: TaskGraphActionRow[];
  artifacts: TaskGraphArtifactRow[];
  bindings: TaskGraphBindingRow[];
  proofEvents?: TaskGraphProofEventRow[];
}

export interface TaskTimelineItem {
  id: string;
  type: 'action' | 'artifact' | 'message' | 'proof';
  title: string;
  description?: string;
  timestamp: string;
  actorId?: string;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function taskIdsFromAction(action: TaskGraphActionRow): string[] {
  return parseJson<string[]>(action.task_ids, []).filter((item): item is string => typeof item === 'string');
}

const ACTION_LABELS: Record<string, string> = {
  'task.created': '任务创建',
  'task.split': '任务拆分',
  'task.claimed': '任务认领',
  'task.handoff_requested': '请求接力',
  'task.handoff_accepted': '接力成功',
  'task.status_changed': '状态变化',
  'task.blocked': '任务阻塞',
  'task.resumed': '任务恢复',
  'task.artifact_attached': '产出关联',
  'task.review_requested': '请求审查',
  'task.merge_requested': '请求合并',
  'task.merged': '任务合并',
  'task.reopened': '任务重开',
  'task.cancelled': '任务取消',
};

export function buildTaskTimeline(graph: TaskGraphApiView | null | undefined, taskId: string): TaskTimelineItem[] {
  if (!graph) return [];

  const actionItems = graph.actions
    .filter((action) => taskIdsFromAction(action).includes(taskId))
    .map((action): TaskTimelineItem => {
      const payload = parseJson<Record<string, unknown>>(action.payload, {});
      const reason = typeof payload.reason === 'string' ? payload.reason : undefined;
      const requestedAction = typeof payload.requestedAction === 'string' ? payload.requestedAction : undefined;
      return {
        id: action.id,
        type: 'action',
        title: ACTION_LABELS[action.type] ?? action.type,
        description: reason ?? requestedAction,
        timestamp: action.created_at,
        actorId: action.actor_id,
      };
    });

  const artifactItems = graph.artifacts
    .filter((artifact) => artifact.task_id === taskId)
    .map((artifact): TaskTimelineItem => ({
      id: artifact.id,
      type: 'artifact',
      title: `产出：${artifact.label}`,
      description: artifact.path ?? artifact.url ?? artifact.kind,
      timestamp: artifact.created_at ?? '',
    }));

  const bindingItems = graph.bindings
    .filter((binding) => binding.task_id === taskId)
    .map((binding): TaskTimelineItem => ({
      id: binding.id,
      type: 'message',
      title: '关联聊天消息',
      description: binding.message_id,
      timestamp: binding.created_at,
    }));

  const proofItems = (graph.proofEvents ?? [])
    .filter((event) => event.task_id === taskId)
    .map((event): TaskTimelineItem => ({
      id: event.id,
      type: 'proof',
      title: event.event_type,
      description: event.reason_code ?? undefined,
      timestamp: event.created_at,
      actorId: event.actor_id ?? event.agent_id ?? undefined,
    }));

  return [...actionItems, ...artifactItems, ...bindingItems, ...proofItems]
    .filter((item) => item.timestamp)
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}
