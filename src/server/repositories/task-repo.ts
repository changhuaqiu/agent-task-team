import { getDb } from '../db/index';
import { DomainEventPublisher, type DomainEventType } from '../platform-events/domain-events';
import {
  assertTaskStatus,
  canTransitionTask,
  type TaskStatus,
} from '../../shared/task-status';

export {
  assertTaskStatus,
  canTransitionTask,
  InvalidTaskStatusError,
  TASK_STATUSES,
  type TaskStatus,
} from '../../shared/task-status';

export interface TaskRow {
  id: string;
  conversation_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  agent_id: string;
  dependencies: string | null;
  artifacts: string | null;
  review_note: string | null;
  revision: number;
  work_dir: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTask {
  id: string;
  conversation_id: string;
  title: string;
  description?: string;
  agent_id: string;
  dependencies?: string[];
  artifacts?: Record<string, unknown>;
  initialStatus?: 'proposed' | 'ready';
  correlationId?: string;
  causationId?: string;
}

export interface TaskTransition {
  to: TaskStatus;
  expectedFrom?: TaskStatus;
  expectedRevision?: number;
  reviewNote?: string;
  correlationId?: string;
  causationId?: string;
}

export class InvalidTaskTransitionError extends Error {
  readonly reasonCode = 'invalid_task_transition';

  constructor(
    readonly taskId: string,
    readonly from: TaskStatus,
    readonly to: TaskStatus,
  ) {
    super(`Illegal task transition for ${taskId}: ${from} -> ${to}`);
  }
}

export class StaleTaskTransitionError extends Error {
  readonly reasonCode = 'stale_task_transition';

  constructor(readonly taskId: string, readonly expected: TaskStatus, readonly actual: TaskStatus) {
    super(`Stale task transition for ${taskId}: expected ${expected}, found ${actual}`);
  }
}

export class StaleTaskRevisionError extends Error {
  readonly reasonCode = 'stale_task_revision';

  constructor(readonly taskId: string, readonly expected: number, readonly actual: number) {
    super(`Stale task revision for ${taskId}: expected ${expected}, found ${actual}`);
  }
}

function taskStatusEvent(previousStatus: TaskStatus, status: TaskStatus): DomainEventType {
  if (status === 'ready') return 'task.ready';
  if (status === 'in_progress' && previousStatus === 'in_review') return 'task.changes_requested';
  if (status === 'in_progress') return 'task.in_progress';
  if (status === 'in_review') return 'task.in_review';
  if (status === 'done') return 'task.done';
  if (status === 'blocked') return 'task.blocked';
  return 'task.cancelled';
}

export type TaskPatch = Pick<
  TaskRow,
  'title' | 'description' | 'agent_id' | 'dependencies' | 'artifacts' | 'review_note'
>;

export const taskRepo = {
  create(input: NewTask): TaskRow {
    const now = new Date().toISOString();
    const status = input.initialStatus ?? 'ready';
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO task (
          id, conversation_id, title, description, status, agent_id,
          dependencies, artifacts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.title,
        input.description ?? null,
        status,
        input.agent_id,
        input.dependencies ? JSON.stringify(input.dependencies) : null,
        input.artifacts ? JSON.stringify(input.artifacts) : null,
        now,
        now,
      );
      if (input.agent_id) {
        new DomainEventPublisher(db).publish({
          type: 'task.assigned',
          projectId: input.conversation_id,
          aggregate: { type: 'task', id: input.id },
          projectAgentId: input.agent_id,
          correlationId: input.correlationId,
          causationId: input.causationId,
          dedupeKey: `task:${input.id}:created:assigned`,
          occurredAt: now,
          payload: { agentId: input.agent_id, status },
        });
      }
      return taskRepo.getById(input.id)!;
    }).immediate();
  },

  getById(id: string): TaskRow | undefined {
    return getDb().prepare('SELECT * FROM task WHERE id = ?').get(id) as TaskRow | undefined;
  },

  getByConversation(conversationId: string): TaskRow[] {
    return getDb()
      .prepare('SELECT * FROM task WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(conversationId) as TaskRow[];
  },

  getByAgent(agentId: string): TaskRow[] {
    return getDb()
      .prepare('SELECT * FROM task WHERE agent_id = ? ORDER BY created_at DESC')
      .all(agentId) as TaskRow[];
  },

  transition(id: string, transition: TaskTransition): TaskRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = taskRepo.getById(id);
      if (!previous) return undefined;
      if (transition.expectedFrom && transition.expectedFrom !== previous.status) {
        throw new StaleTaskTransitionError(id, transition.expectedFrom, previous.status);
      }
      if (
        transition.expectedRevision !== undefined
        && transition.expectedRevision !== previous.revision
      ) {
        throw new StaleTaskRevisionError(id, transition.expectedRevision, previous.revision);
      }
      if (!canTransitionTask(previous.status, transition.to)) {
        throw new InvalidTaskTransitionError(id, previous.status, transition.to);
      }
      if (previous.status === transition.to) {
        if (
          transition.reviewNote !== undefined
          && transition.reviewNote !== previous.review_note
        ) {
          const updated = db.prepare(`
            UPDATE task
            SET review_note=?, revision=revision+1, updated_at=?
            WHERE id=? AND status=? AND revision=?
          `).run(transition.reviewNote, now, id, previous.status, previous.revision);
          if (updated.changes !== 1) {
            const current = taskRepo.getById(id);
            if (current) throw new StaleTaskRevisionError(id, previous.revision, current.revision);
            return undefined;
          }
        }
        return taskRepo.getById(id);
      }
      const result = db.prepare(
        `UPDATE task
         SET status=?, review_note=COALESCE(?, review_note), revision=revision+1, updated_at=?
         WHERE id=? AND status=? AND revision=?`,
      ).run(
        transition.to,
        transition.reviewNote ?? null,
        now,
        id,
        previous.status,
        previous.revision,
      );
      if (result.changes !== 1) {
        const current = taskRepo.getById(id);
        if (current) {
          if (current.status !== previous.status) {
            throw new StaleTaskTransitionError(id, previous.status, current.status);
          }
          throw new StaleTaskRevisionError(id, previous.revision, current.revision);
        }
        return undefined;
      }
      const current = taskRepo.getById(id)!;
      const type = taskStatusEvent(previous.status, transition.to);
      new DomainEventPublisher(db).publish({
        type,
        projectId: previous.conversation_id,
        aggregate: { type: 'task', id, version: current.revision },
        projectAgentId: previous.agent_id,
        correlationId: transition.correlationId,
        causationId: transition.causationId,
        occurredAt: now,
        payload: {
          previousStatus: previous.status,
          status: transition.to,
          agentId: previous.agent_id,
          ...(transition.reviewNote ? { reviewNote: transition.reviewNote } : {}),
        } as never,
      });
      return current;
    }).immediate();
  },

  update(
    id: string,
    updates: Partial<TaskPatch>,
    trace?: { correlationId?: string; causationId?: string },
  ): TaskRow | undefined {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return taskRepo.getById(id);
    const now = new Date().toISOString();
    sets.push('revision = revision + 1');
    sets.push('updated_at = ?');
    values.push(now, id);
    const db = getDb();
    return db.transaction(() => {
      const previous = taskRepo.getById(id);
      if (!previous) return undefined;
      const result = db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes !== 1) return undefined;
      if (
        updates.agent_id !== undefined
        && updates.agent_id !== previous.agent_id
        && updates.agent_id !== ''
      ) {
        new DomainEventPublisher(db).publish({
          type: 'task.assigned',
          projectId: previous.conversation_id,
          aggregate: { type: 'task', id },
          projectAgentId: updates.agent_id,
          correlationId: trace?.correlationId,
          causationId: trace?.causationId,
          occurredAt: now,
          payload: {
            previousAgentId: previous.agent_id,
            agentId: updates.agent_id,
            status: previous.status,
          },
        });
      }
      return taskRepo.getById(id);
    }).immediate();
  },

  /**
   * Runtime projection location is an operational pointer, not an
   * authoritative Task fact. Updating it must not invalidate a WorkContract
   * or Gate that froze the Task's semantic revision.
   */
  setProjectionWorkDir(id: string, workDir: string): TaskRow | undefined {
    const result = getDb().prepare(`
      UPDATE task
      SET work_dir=?, updated_at=?
      WHERE id=? AND COALESCE(work_dir,'')<>?
    `).run(workDir, new Date().toISOString(), id, workDir);
    if (result.changes === 0 && !taskRepo.getById(id)) return undefined;
    return taskRepo.getById(id);
  },

  list(): TaskRow[] {
    return getDb().prepare('SELECT * FROM task ORDER BY created_at ASC').all() as TaskRow[];
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM task WHERE id = ?').run(id);
  },
};
