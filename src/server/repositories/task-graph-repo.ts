import { createHash } from 'node:crypto';
import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import { taskRepo, type NewTask, type TaskPatch, type TaskRow } from './task-repo';

export type TaskActionType =
  | 'task.created'
  | 'task.split'
  | 'task.claimed'
  | 'task.handoff_requested'
  | 'task.handoff_accepted'
  | 'task.status_changed'
  | 'task.dependencies_replaced'
  | 'task.blocked'
  | 'task.resumed'
  | 'task.artifact_attached'
  | 'task.review_requested'
  | 'task.pull_request_submitted'
  | 'task.provider_review_received'
  | 'task.review_recorded'
  | 'task.pull_request_merged'
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

export type ArtifactKind = 'file' | 'diff' | 'test' | 'doc' | 'design' | 'url' | 'log' | 'proof' | 'pull_request' | 'review' | 'merge';

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
  revision: number;
  tasks: TaskRow[];
  edges: TaskEdgeRow[];
  actions: TaskActionRow[];
  artifacts: TaskArtifactRefRow[];
  bindings: ChatTaskBindingRow[];
}

export interface TaskGraphCommitTask extends Omit<NewTask, 'conversation_id'> {
  dependencies?: string[];
}

export interface TaskGraphCommitResult {
  revision: number;
  tasks: TaskRow[];
  edges: TaskEdgeRow[];
  action: TaskActionRow;
}

export class StaleTaskGraphRevisionError extends Error {
  readonly reasonCode = 'stale_task_graph_revision';

  constructor(
    readonly conversationId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Stale Task Graph revision for ${conversationId}: `
      + `expected ${expectedRevision}, actual ${actualRevision}`,
    );
  }
}

export class InvalidTaskGraphError extends Error {
  readonly reasonCode = 'invalid_task_graph';
}

export class TaskGraphIdempotencyConflictError extends Error {
  readonly reasonCode = 'task_graph_idempotency_conflict';
}

export class TaskGraphLegacyReplayUnavailableError extends Error {
  readonly reasonCode = 'task_graph_legacy_replay_unavailable';
}

interface TaskGraphCommitRow {
  idempotency_key: string;
  conversation_id: string;
  request_digest: string;
  revision: number;
  action_id: string;
  result_json: string;
  created_at: string;
}

export type TaskGraphCommitRecord = TaskGraphCommitRow;

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function requestDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) throw new InvalidTaskGraphError('Task Graph result is not serializable');
  return serialized;
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

function dependencyIds(task: TaskRow): string[] {
  if (!task.dependencies) return [];
  try {
    const parsed = JSON.parse(task.dependencies) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
      throw new Error('invalid dependencies');
    }
    return parsed;
  } catch {
    throw new InvalidTaskGraphError(`Task ${task.id} has malformed dependencies`);
  }
}

function assertAcyclicDependencies(dependencies: ReadonlyMap<string, readonly string[]>): void {
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (taskId: string): void => {
    if (active.has(taskId)) {
      throw new InvalidTaskGraphError(`Task dependency cycle contains ${taskId}`);
    }
    if (visited.has(taskId)) return;
    active.add(taskId);
    for (const dependency of dependencies.get(taskId) ?? []) visit(dependency);
    active.delete(taskId);
    visited.add(taskId);
  };
  for (const taskId of [...dependencies.keys()].sort()) visit(taskId);
}

export const taskGraphRepo = {
  getCommitByIdempotencyKey(idempotencyKey: string): TaskGraphCommitRecord | undefined {
    return getDb().prepare(
      'SELECT * FROM task_graph_commit WHERE idempotency_key=?',
    ).get(idempotencyKey) as TaskGraphCommitRecord | undefined;
  },

  revision(conversationId: string): number {
    const row = getDb().prepare(`
      SELECT revision FROM task_graph_revision WHERE conversation_id=?
    `).get(conversationId) as { revision: number } | undefined;
    return row?.revision ?? 0;
  },

  mutate<T>(input: {
    conversationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    operation: string;
    request: unknown;
    execute: () => { actionId: string; result: T };
    now?: Date;
  }): { revision: number; result: T; replayed: boolean } {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new InvalidTaskGraphError('Task Graph expectedRevision must be non-negative');
    }
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) throw new InvalidTaskGraphError('Task Graph idempotencyKey is required');
    const digest = requestDigest({
      conversationId: input.conversationId,
      expectedRevision: input.expectedRevision,
      operation: input.operation,
      request: input.request,
    });
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const conversation = db.prepare('SELECT 1 FROM conversation WHERE id=?')
        .get(input.conversationId);
      if (!conversation) {
        throw new InvalidTaskGraphError(`Conversation ${input.conversationId} not found`);
      }
      const duplicate = db.prepare(`
        SELECT * FROM task_graph_commit WHERE idempotency_key=?
      `).get(idempotencyKey) as TaskGraphCommitRow | undefined;
      if (duplicate) {
        if (
          duplicate.conversation_id !== input.conversationId
          || duplicate.request_digest !== digest
        ) throw new TaskGraphIdempotencyConflictError(idempotencyKey);
        if (duplicate.result_json === '{}') {
          throw new TaskGraphLegacyReplayUnavailableError(idempotencyKey);
        }
        return {
          revision: duplicate.revision,
          result: JSON.parse(duplicate.result_json) as T,
          replayed: true,
        };
      }
      db.prepare(`
        INSERT OR IGNORE INTO task_graph_revision (conversation_id,revision,updated_at)
        VALUES (?,0,?)
      `).run(input.conversationId, timestamp);
      const actualRevision = taskGraphRepo.revision(input.conversationId);
      if (actualRevision !== input.expectedRevision) {
        throw new StaleTaskGraphRevisionError(
          input.conversationId,
          input.expectedRevision,
          actualRevision,
        );
      }
      const executed = input.execute();
      const action = taskGraphRepo.getActionById(executed.actionId);
      if (!action || action.conversation_id !== input.conversationId) {
        throw new InvalidTaskGraphError('Task Graph mutation must create an owned action');
      }
      const updated = db.prepare(`
        UPDATE task_graph_revision
        SET revision=revision+1,updated_at=?
        WHERE conversation_id=? AND revision=?
      `).run(timestamp, input.conversationId, input.expectedRevision);
      if (updated.changes !== 1) {
        throw new StaleTaskGraphRevisionError(
          input.conversationId,
          input.expectedRevision,
          taskGraphRepo.revision(input.conversationId),
        );
      }
      const revision = input.expectedRevision + 1;
      db.prepare(`
        INSERT INTO task_graph_commit (
          idempotency_key,conversation_id,request_digest,revision,action_id,result_json,created_at
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        idempotencyKey,
        input.conversationId,
        digest,
        revision,
        executed.actionId,
        canonicalJson(executed.result),
        timestamp,
      );
      return { revision, result: executed.result, replayed: false };
    }).immediate();
  },

  commit(input: {
    conversationId: string;
    expectedRevision: number;
    idempotencyKey: string;
    actorId: string;
    actorType: 'user' | 'agent' | 'system';
    correlationId?: string;
    causationId?: string;
    tasks: TaskGraphCommitTask[];
    now?: Date;
  }): TaskGraphCommitResult {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new InvalidTaskGraphError('Task Graph expectedRevision must be non-negative');
    }
    if (input.tasks.length === 0) {
      throw new InvalidTaskGraphError('Task Graph commit requires at least one task');
    }
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw new InvalidTaskGraphError('Task Graph idempotencyKey is required');
    }
    const ids = input.tasks.map((task) => task.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      throw new InvalidTaskGraphError('Task Graph task ids must be non-empty and unique');
    }
    const digest = requestDigest({
      conversationId: input.conversationId,
      expectedRevision: input.expectedRevision,
      actorId: input.actorId,
      actorType: input.actorType,
      correlationId: input.correlationId,
      causationId: input.causationId,
      tasks: input.tasks,
    });
    const db = getDb();
    return db.transaction(() => {
      const conversation = db.prepare('SELECT 1 FROM conversation WHERE id=?')
        .get(input.conversationId);
      if (!conversation) {
        throw new InvalidTaskGraphError(`Conversation ${input.conversationId} not found`);
      }
      const duplicate = db.prepare(`
        SELECT * FROM task_graph_commit WHERE idempotency_key=?
      `).get(idempotencyKey) as TaskGraphCommitRow | undefined;
      if (duplicate) {
        if (
          duplicate.conversation_id !== input.conversationId
          || duplicate.request_digest !== digest
        ) {
          throw new TaskGraphIdempotencyConflictError(idempotencyKey);
        }
        const frozen = JSON.parse(duplicate.result_json) as Partial<TaskGraphCommitResult>;
        if (
          frozen.revision === duplicate.revision
          && Array.isArray(frozen.tasks)
          && Array.isArray(frozen.edges)
          && frozen.action?.id === duplicate.action_id
        ) return frozen as TaskGraphCommitResult;
        throw new TaskGraphLegacyReplayUnavailableError(idempotencyKey);
      }
      const timestamp = (input.now ?? new Date()).toISOString();
      db.prepare(`
        INSERT OR IGNORE INTO task_graph_revision (conversation_id,revision,updated_at)
        VALUES (?,0,?)
      `).run(input.conversationId, timestamp);
      const actualRevision = taskGraphRepo.revision(input.conversationId);
      if (actualRevision !== input.expectedRevision) {
        throw new StaleTaskGraphRevisionError(
          input.conversationId,
          input.expectedRevision,
          actualRevision,
        );
      }

      const existing = taskRepo.getByConversation(input.conversationId);
      const knownIds = new Set([...existing.map((task) => task.id), ...ids]);
      const dependencyMap = new Map<string, readonly string[]>(
        existing.map((task) => [task.id, dependencyIds(task)]),
      );
      for (const task of input.tasks) {
        if (taskRepo.getById(task.id)) {
          throw new InvalidTaskGraphError(`Task ${task.id} already exists`);
        }
        const dependencies = [...new Set(task.dependencies ?? [])];
        for (const dependency of dependencies) {
          if (!knownIds.has(dependency)) {
            throw new InvalidTaskGraphError(
              `Task ${task.id} depends on missing task ${dependency}`,
            );
          }
          if (dependency === task.id) {
            throw new InvalidTaskGraphError(`Task ${task.id} cannot depend on itself`);
          }
        }
        dependencyMap.set(task.id, dependencies);
      }
      assertAcyclicDependencies(dependencyMap);

      const tasks = input.tasks.map((task) => taskRepo.create({
        ...task,
        conversation_id: input.conversationId,
        dependencies: [...new Set(task.dependencies ?? [])],
        correlationId: input.correlationId,
        causationId: input.causationId,
      }));
      const action = taskGraphRepo.appendAction({
        conversationId: input.conversationId,
        actorId: input.actorId,
        actorType: input.actorType,
        type: tasks.length === 1 ? 'task.created' : 'task.split',
        taskIds: tasks.map((task) => task.id),
        payload: {
          idempotencyKey,
          requestDigest: digest,
          expectedRevision: input.expectedRevision,
          nextRevision: input.expectedRevision + 1,
        },
      });
      const edges = tasks.flatMap((task) =>
        dependencyIds(task).map((dependency) => taskGraphRepo.addEdge({
          conversationId: input.conversationId,
          fromTaskId: task.id,
          toTaskId: dependency,
          type: 'depends_on',
          createdByActionId: action.id,
        })));
      const updated = db.prepare(`
        UPDATE task_graph_revision
        SET revision=revision+1,updated_at=?
        WHERE conversation_id=? AND revision=?
      `).run(timestamp, input.conversationId, input.expectedRevision);
      if (updated.changes !== 1) {
        throw new StaleTaskGraphRevisionError(
          input.conversationId,
          input.expectedRevision,
          taskGraphRepo.revision(input.conversationId),
        );
      }
      const committed = {
        revision: input.expectedRevision + 1,
        tasks,
        edges,
        action,
      };
      db.prepare(`
        INSERT INTO task_graph_commit (
          idempotency_key,conversation_id,request_digest,revision,action_id,result_json,created_at
        ) VALUES (?,?,?,?,?,?,?)
      `).run(
        idempotencyKey,
        input.conversationId,
        digest,
        committed.revision,
        action.id,
        canonicalJson(committed),
        timestamp,
      );
      return committed;
    }).immediate();
  },

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

  replaceDependencies(input: {
    conversationId: string;
    taskId: string;
    dependencyTaskIds: string[];
    createdByActionId: string;
    updates?: Partial<Omit<TaskPatch, 'dependencies'>>;
    correlationId?: string;
    causationId?: string;
  }): { task: TaskRow; edges: TaskEdgeRow[] } {
    assertTaskInConversation(input.taskId, input.conversationId);
    assertActionInConversation(input.createdByActionId, input.conversationId);
    const dependencies = [...new Set(input.dependencyTaskIds)].sort();
    const tasks = taskRepo.getByConversation(input.conversationId);
    const knownIds = new Set(tasks.map((task) => task.id));
    for (const dependencyId of dependencies) {
      if (!knownIds.has(dependencyId)) {
        throw new InvalidTaskGraphError(
          `Task ${input.taskId} depends on missing task ${dependencyId}`,
        );
      }
      if (dependencyId === input.taskId) {
        throw new InvalidTaskGraphError(`Task ${input.taskId} cannot depend on itself`);
      }
    }
    const dependencyMap = new Map<string, readonly string[]>(
      tasks.map((task) => [
        task.id,
        task.id === input.taskId ? dependencies : dependencyIds(task),
      ]),
    );
    assertAcyclicDependencies(dependencyMap);

    const db = getDb();
    db.prepare(`
      DELETE FROM task_edge
      WHERE conversation_id=? AND from_task_id=? AND type='depends_on'
    `).run(input.conversationId, input.taskId);
    const task = taskRepo.update(input.taskId, {
      ...input.updates,
      dependencies: JSON.stringify(dependencies),
    }, {
      correlationId: input.correlationId,
      causationId: input.causationId,
    });
    if (!task) throw new InvalidTaskGraphError(`Task ${input.taskId} not found`);
    const edges = dependencies.map((dependencyId) => taskGraphRepo.addEdge({
      conversationId: input.conversationId,
      fromTaskId: input.taskId,
      toTaskId: dependencyId,
      type: 'depends_on',
      createdByActionId: input.createdByActionId,
    }));
    return { task, edges };
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
      revision: this.revision(conversationId),
      tasks: taskRepo.getByConversation(conversationId),
      edges: this.listEdges(conversationId),
      actions: this.listActions(conversationId),
      artifacts: this.listArtifacts(conversationId),
      bindings: this.listBindings(conversationId),
    };
  },

};
