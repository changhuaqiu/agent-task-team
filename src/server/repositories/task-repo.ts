import { getDb } from '../db/index';
import { DomainEventPublisher, type DomainEventType } from '../platform-events/domain-events';

export interface TaskRow {
  id: string;
  conversation_id: string;
  title: string;
  description: string | null;
  status: string;
  agent_id: string;
  dependencies: string | null;
  artifacts: string | null;
  review_note: string | null;
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
}

function taskStatusEvent(previousStatus: string, status: string): DomainEventType | undefined {
  if (status === 'in_progress') return 'task.in_progress';
  if (status === 'in_review') return 'task.in_review';
  if (status === 'rejected') return 'task.rejected';
  if (status === 'done' || status === 'completed' || status === 'approved') return 'task.done';
  if (status === 'blocked') return 'task.blocked';
  if (status === 'cancelled' || status === 'canceled') return 'task.cancelled';
  if (status === 'pending' && previousStatus !== 'pending') return 'task.reopened';
  return undefined;
}

export const taskRepo = {
  create(input: NewTask): TaskRow {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO task (id, conversation_id, title, description, status, agent_id, dependencies, artifacts, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.title,
        input.description ?? null,
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
          dedupeKey: `task:${input.id}:created:assigned`,
          occurredAt: now,
          payload: { agentId: input.agent_id, status: 'pending' },
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

  updateStatus(id: string, status: string, reviewNote?: string): void {
    const now = new Date().toISOString();
    const db = getDb();
    db.transaction(() => {
      const previous = taskRepo.getById(id);
      if (!previous) return;
      if (previous.status === status) {
        if (reviewNote !== undefined && previous.review_note !== reviewNote) {
          db.prepare('UPDATE task SET review_note = ?, updated_at = ? WHERE id = ?')
            .run(reviewNote, now, id);
        }
        return;
      }
      const result = reviewNote !== undefined
        ? db
        .prepare('UPDATE task SET status = ?, review_note = ?, updated_at = ? WHERE id = ?')
        .run(status, reviewNote, now, id)
        : db.prepare('UPDATE task SET status = ?, updated_at = ? WHERE id = ?').run(status, now, id);
      if (result.changes !== 1) return;
      const type = taskStatusEvent(previous.status, status);
      if (!type) return;
      new DomainEventPublisher(db).publish({
        type,
        projectId: previous.conversation_id,
        aggregate: { type: 'task', id },
        projectAgentId: previous.agent_id,
        occurredAt: now,
        payload: {
          previousStatus: previous.status,
          status,
          agentId: previous.agent_id,
          ...(reviewNote ? { reviewNote } : {}),
        } as never,
      });
    }).immediate();
  },

  update(id: string, updates: Partial<Pick<TaskRow, 'title' | 'description' | 'status' | 'agent_id' | 'dependencies' | 'artifacts' | 'review_note' | 'work_dir'>>): void {
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = ?`);
      values.push(value);
    }
    if (sets.length === 0) return;
    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(id);
    const db = getDb();
    db.transaction(() => {
      const previous = taskRepo.getById(id);
      if (!previous) return;
      const result = db.prepare(`UPDATE task SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      if (result.changes !== 1) return;
      const publisher = new DomainEventPublisher(db);
      const now = values.at(-2) as string;
      if (
        updates.agent_id !== undefined
        && updates.agent_id !== previous.agent_id
        && updates.agent_id !== ''
      ) {
        publisher.publish({
          type: 'task.assigned',
          projectId: previous.conversation_id,
          aggregate: { type: 'task', id },
          projectAgentId: updates.agent_id,
          occurredAt: now,
          payload: {
            previousAgentId: previous.agent_id,
            agentId: updates.agent_id,
            status: updates.status ?? previous.status,
          },
        });
      }
      if (updates.status && updates.status !== previous.status) {
        const type = taskStatusEvent(previous.status, updates.status);
        if (type) {
          publisher.publish({
            type,
            projectId: previous.conversation_id,
            aggregate: { type: 'task', id },
            projectAgentId: updates.agent_id ?? previous.agent_id,
            occurredAt: now,
            payload: {
              previousStatus: previous.status,
              status: updates.status,
              agentId: updates.agent_id ?? previous.agent_id,
              ...(updates.review_note ? { reviewNote: updates.review_note } : {}),
            } as never,
          });
        }
      }
    }).immediate();
  },

  list(): TaskRow[] {
    return getDb().prepare('SELECT * FROM task ORDER BY created_at ASC').all() as TaskRow[];
  },

  delete(id: string): void {
    getDb().prepare('DELETE FROM task WHERE id = ?').run(id);
  },
};
