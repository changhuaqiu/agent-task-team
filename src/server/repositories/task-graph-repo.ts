import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import { taskRepo, type TaskRow } from './task-repo';

export type TaskActionType =
  | 'task.created'
  | 'task.split'
  | 'task.claimed'
  | 'task.handoff_requested'
  | 'task.handoff_accepted'
  | 'task.status_changed'
  | 'task.blocked'
  | 'task.resumed'
  | 'task.artifact_attached'
  | 'task.review_requested'
  | 'task.merge_requested'
  | 'task.merged'
  | 'task.reopened'
  | 'task.cancelled';

export type TaskEdgeType =
  | 'subtask_of'
  | 'depends_on'
  | 'blocks'
  | 'derived_from'
  | 'merged_into'
  | 'review_of'
  | 'reopens';

export type ArtifactKind = 'file' | 'diff' | 'test' | 'doc' | 'design' | 'url' | 'log' | 'proof';

export interface TaskActionRow {
  id: string;
  conversation_id: string;
  actor_id: string;
  actor_type: 'user' | 'agent' | 'system';
  type: TaskActionType;
  task_ids: string;
  message_id: string | null;
  pass_id: string | null;
  possession_id: string | null;
  proof_event_id: string | null;
  payload: string;
  created_at: string;
}

export interface TaskEdgeRow {
  id: string;
  conversation_id: string;
  from_task_id: string;
  to_task_id: string;
  type: TaskEdgeType;
  created_by_action_id: string;
  created_at: string;
}

export interface TaskArtifactRefRow {
  id: string;
  conversation_id: string;
  task_id: string;
  kind: ArtifactKind;
  label: string;
  path: string | null;
  url: string | null;
  proof_event_id: string | null;
  created_by_action_id: string;
  created_at: string;
}

export interface ChatTaskBindingRow {
  id: string;
  conversation_id: string;
  message_id: string;
  task_id: string;
  action_id: string | null;
  created_at: string;
}

export interface TaskGraphView {
  conversationId: string;
  tasks: TaskRow[];
  edges: TaskEdgeRow[];
  actions: TaskActionRow[];
  artifacts: TaskArtifactRefRow[];
  bindings: ChatTaskBindingRow[];
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function parseTaskIds(action: TaskActionRow): string[] {
  try {
    const parsed = JSON.parse(action.task_ids);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function assertTaskInConversation(taskId: string, conversationId: string): TaskRow {
  const task = taskRepo.getById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.conversation_id !== conversationId) {
    throw new Error(`Task ${taskId} does not belong to conversation ${conversationId}`);
  }
  return task;
}

function assertActionInConversation(actionId: string, conversationId: string): TaskActionRow {
  const action = taskGraphRepo.getActionById(actionId);
  if (!action) throw new Error(`Task action ${actionId} not found`);
  if (action.conversation_id !== conversationId) {
    throw new Error(`Task action ${actionId} does not belong to conversation ${conversationId}`);
  }
  return action;
}

function hasPath(conversationId: string, fromTaskId: string, toTaskId: string, type: TaskEdgeType): boolean {
  const edges = taskGraphRepo.listEdges(conversationId).filter((edge) => edge.type === type);
  const nextByFrom = new Map<string, string[]>();
  for (const edge of edges) {
    nextByFrom.set(edge.from_task_id, [...(nextByFrom.get(edge.from_task_id) ?? []), edge.to_task_id]);
  }

  const seen = new Set<string>();
  const stack = [fromTaskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === toTaskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of nextByFrom.get(current) ?? []) stack.push(next);
  }
  return false;
}

function shouldRejectCycles(type: TaskEdgeType): boolean {
  return type === 'subtask_of' || type === 'depends_on' || type === 'merged_into';
}

export const taskGraphRepo = {
  appendAction(input: {
    conversationId: string;
    actorId: string;
    actorType: 'user' | 'agent' | 'system';
    type: TaskActionType;
    taskIds?: string[];
    messageId?: string;
    passId?: string;
    possessionId?: string;
    proofEventId?: string;
    payload?: Record<string, unknown>;
  }): TaskActionRow {
    const id = generateSortableId('task-action');
    const now = new Date().toISOString();
    const taskIds = input.taskIds ?? [];
    for (const taskId of taskIds) assertTaskInConversation(taskId, input.conversationId);

    getDb().prepare(`
      INSERT INTO task_action
        (id, conversation_id, actor_id, actor_type, type, task_ids, message_id, pass_id, possession_id, proof_event_id, payload, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.conversationId,
      input.actorId,
      input.actorType,
      input.type,
      JSON.stringify(taskIds),
      input.messageId ?? null,
      input.passId ?? null,
      input.possessionId ?? null,
      input.proofEventId ?? null,
      stringifyJson(input.payload),
      now,
    );

    return this.getActionById(id)!;
  },

  getActionById(id: string): TaskActionRow | undefined {
    return getDb().prepare('SELECT * FROM task_action WHERE id = ?').get(id) as TaskActionRow | undefined;
  },

  listActions(conversationId: string): TaskActionRow[] {
    return getDb()
      .prepare('SELECT * FROM task_action WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as TaskActionRow[];
  },

  listActionsForTask(taskId: string): TaskActionRow[] {
    return getDb()
      .prepare('SELECT * FROM task_action ORDER BY created_at ASC, id ASC')
      .all()
      .filter((action) => parseTaskIds(action as TaskActionRow).includes(taskId)) as TaskActionRow[];
  },

  addEdge(input: {
    conversationId: string;
    fromTaskId: string;
    toTaskId: string;
    type: TaskEdgeType;
    createdByActionId: string;
  }): TaskEdgeRow {
    if (input.fromTaskId === input.toTaskId) throw new Error('Task edge cannot point to itself');
    assertTaskInConversation(input.fromTaskId, input.conversationId);
    assertTaskInConversation(input.toTaskId, input.conversationId);
    assertActionInConversation(input.createdByActionId, input.conversationId);

    if (shouldRejectCycles(input.type) && hasPath(input.conversationId, input.toTaskId, input.fromTaskId, input.type)) {
      throw new Error(`Task edge would create a ${input.type} cycle`);
    }

    const id = generateSortableId('task-edge');
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO task_edge
        (id, conversation_id, from_task_id, to_task_id, type, created_by_action_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.conversationId, input.fromTaskId, input.toTaskId, input.type, input.createdByActionId, now);

    return this.getEdgeById(id)!;
  },

  getEdgeById(id: string): TaskEdgeRow | undefined {
    return getDb().prepare('SELECT * FROM task_edge WHERE id = ?').get(id) as TaskEdgeRow | undefined;
  },

  listEdges(conversationId: string): TaskEdgeRow[] {
    return getDb()
      .prepare('SELECT * FROM task_edge WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as TaskEdgeRow[];
  },

  addArtifact(input: {
    conversationId: string;
    taskId: string;
    kind: ArtifactKind;
    label: string;
    path?: string;
    url?: string;
    proofEventId?: string;
    createdByActionId: string;
  }): TaskArtifactRefRow {
    assertTaskInConversation(input.taskId, input.conversationId);
    assertActionInConversation(input.createdByActionId, input.conversationId);
    const id = generateSortableId('task-artifact');
    const now = new Date().toISOString();

    getDb().prepare(`
      INSERT INTO task_artifact_ref
        (id, conversation_id, task_id, kind, label, path, url, proof_event_id, created_by_action_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.conversationId,
      input.taskId,
      input.kind,
      input.label,
      input.path ?? null,
      input.url ?? null,
      input.proofEventId ?? null,
      input.createdByActionId,
      now,
    );

    return this.getArtifactById(id)!;
  },

  getArtifactById(id: string): TaskArtifactRefRow | undefined {
    return getDb().prepare('SELECT * FROM task_artifact_ref WHERE id = ?').get(id) as TaskArtifactRefRow | undefined;
  },

  listArtifacts(conversationId: string): TaskArtifactRefRow[] {
    return getDb()
      .prepare('SELECT * FROM task_artifact_ref WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as TaskArtifactRefRow[];
  },

  bindMessage(input: {
    conversationId: string;
    messageId: string;
    taskId: string;
    actionId?: string;
  }): ChatTaskBindingRow {
    assertTaskInConversation(input.taskId, input.conversationId);
    if (input.actionId) assertActionInConversation(input.actionId, input.conversationId);
    const id = generateSortableId('chat-task');
    const now = new Date().toISOString();

    getDb().prepare(`
      INSERT INTO chat_task_binding
        (id, conversation_id, message_id, task_id, action_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.conversationId, input.messageId, input.taskId, input.actionId ?? null, now);

    return this.getBindingById(id)!;
  },

  getBindingById(id: string): ChatTaskBindingRow | undefined {
    return getDb().prepare('SELECT * FROM chat_task_binding WHERE id = ?').get(id) as ChatTaskBindingRow | undefined;
  },

  listBindings(conversationId: string): ChatTaskBindingRow[] {
    return getDb()
      .prepare('SELECT * FROM chat_task_binding WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as ChatTaskBindingRow[];
  },

  getGraph(conversationId: string): TaskGraphView {
    return {
      conversationId,
      tasks: taskRepo.getByConversation(conversationId),
      edges: this.listEdges(conversationId),
      actions: this.listActions(conversationId),
      artifacts: this.listArtifacts(conversationId),
      bindings: this.listBindings(conversationId),
    };
  },

  recordHandoffRequested(input: {
    conversationId: string;
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    messageId?: string;
    passId?: string;
    possessionId?: string;
    requestedAction?: string;
  }): TaskActionRow {
    return this.appendAction({
      conversationId: input.conversationId,
      actorId: input.fromAgentId,
      actorType: input.fromAgentId === 'user' ? 'user' : 'agent',
      type: 'task.handoff_requested',
      taskIds: [input.taskId],
      messageId: input.messageId,
      passId: input.passId,
      possessionId: input.possessionId,
      payload: {
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
        requestedAction: input.requestedAction,
      },
    });
  },

  recordHandoffAccepted(input: {
    conversationId: string;
    taskId: string;
    fromAgentId: string;
    toAgentId: string;
    passId?: string;
    possessionId?: string;
    status?: string;
  }): TaskActionRow {
    assertTaskInConversation(input.taskId, input.conversationId);
    taskRepo.update(input.taskId, {
      agent_id: input.toAgentId,
      status: input.status ?? 'in_progress',
    });

    return this.appendAction({
      conversationId: input.conversationId,
      actorId: input.toAgentId,
      actorType: input.toAgentId === 'user' ? 'user' : 'agent',
      type: 'task.handoff_accepted',
      taskIds: [input.taskId],
      passId: input.passId,
      possessionId: input.possessionId,
      payload: {
        fromAgentId: input.fromAgentId,
        toAgentId: input.toAgentId,
      },
    });
  },
};
