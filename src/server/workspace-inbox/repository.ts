import type Database from 'better-sqlite3';
import { getDb } from '../db';

export type WorkspaceInboxKind = 'message_thread' | 'work' | 'review' | 'agent_activity' | 'reminder' | 'draft';
export type WorkspaceInboxFilter = 'all' | 'needs_action' | 'agents' | 'reviews';

const RUNTIME_OBSERVATION_CONTENT_TYPES = ['thinking', 'tool_use', 'tool_result'] as const;
const LEGACY_RUNTIME_FAILURE_PREFIX = '⚠️ Agent runtime 未返回最终文本%';

export interface WorkspaceInboxItem {
  conversationKey: string;
  kind: WorkspaceInboxKind;
  projectId?: string;
  projectName?: string;
  subject: { type: string; id: string };
  actor: { type: string; id: string };
  title: string;
  preview: string;
  actionState: 'informational' | 'needs_action' | 'resolved';
  latestEventId: string;
  latestAt: string;
  unreadCount: number;
  readAt?: string;
  metadata: Record<string, unknown>;
  revision: number;
}

interface InboxRow {
  conversation_key: string;
  kind: WorkspaceInboxKind;
  project_id: string | null;
  project_name: string | null;
  subject_type: string;
  subject_id: string;
  actor_type: string;
  actor_id: string;
  title: string;
  preview: string;
  action_state: WorkspaceInboxItem['actionState'];
  latest_event_id: string;
  latest_at: string;
  unread_count: number;
  read_at: string | null;
  metadata_json: string;
  revision: number;
}

interface ProjectionInput {
  conversationKey: string;
  kind: WorkspaceInboxKind;
  projectId?: string;
  subject: { type: string; id: string };
  actor: { type: string; id: string };
  title: string;
  preview?: string;
  actionState?: WorkspaceInboxItem['actionState'];
  latestEventId: string;
  latestAt: string;
  metadata?: Record<string, unknown>;
}

function parseObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function hydrate(row: InboxRow): WorkspaceInboxItem {
  return {
    conversationKey: row.conversation_key,
    kind: row.kind,
    ...(row.project_id ? { projectId: row.project_id } : {}),
    ...(row.project_name ? { projectName: row.project_name } : {}),
    subject: { type: row.subject_type, id: row.subject_id },
    actor: { type: row.actor_type, id: row.actor_id },
    title: row.title,
    preview: row.preview,
    actionState: row.action_state,
    latestEventId: row.latest_event_id,
    latestAt: row.latest_at,
    unreadCount: row.unread_count,
    ...(row.read_at ? { readAt: row.read_at } : {}),
    metadata: parseObject(row.metadata_json),
    revision: row.revision,
  };
}

function threadRoot(metadata: Record<string, unknown>, messageId: string): string {
  for (const key of ['threadRootId', 'rootMessageId', 'replyRootId']) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return messageId;
}

export class WorkspaceInboxRepository {
  constructor(private readonly database?: Database.Database) {}

  private db() { return this.database ?? getDb(); }

  project(input: ProjectionInput): void {
    const now = new Date().toISOString();
    this.db().prepare(`
      INSERT INTO workspace_inbox_item (
        conversation_key,kind,project_id,subject_type,subject_id,actor_type,actor_id,
        title,preview,action_state,latest_event_id,latest_at,unread_count,read_at,
        metadata_json,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,NULL,?,1,?,?)
      ON CONFLICT(conversation_key) DO UPDATE SET
        kind=excluded.kind,project_id=excluded.project_id,subject_type=excluded.subject_type,
        subject_id=excluded.subject_id,actor_type=excluded.actor_type,actor_id=excluded.actor_id,
        title=excluded.title,preview=excluded.preview,action_state=excluded.action_state,
        latest_event_id=excluded.latest_event_id,latest_at=excluded.latest_at,
        unread_count=CASE
          WHEN excluded.latest_event_id<>workspace_inbox_item.latest_event_id
            AND (workspace_inbox_item.read_at IS NULL OR excluded.latest_at>workspace_inbox_item.read_at)
          THEN workspace_inbox_item.unread_count+1
          ELSE workspace_inbox_item.unread_count
        END,
        metadata_json=excluded.metadata_json,
        revision=CASE WHEN excluded.latest_event_id<>workspace_inbox_item.latest_event_id
          THEN workspace_inbox_item.revision+1 ELSE workspace_inbox_item.revision END,
        updated_at=excluded.updated_at
    `).run(
      input.conversationKey, input.kind, input.projectId ?? null,
      input.subject.type, input.subject.id, input.actor.type, input.actor.id,
      input.title.trim(), input.preview?.trim() ?? '', input.actionState ?? 'informational',
      input.latestEventId, input.latestAt, JSON.stringify(input.metadata ?? {}), now, now,
    );
  }

  reconcile(): void {
    const db = this.db();
    db.transaction(() => {
      const tasks = db.prepare(`
        SELECT task.id,task.title,task.description,task.status,task.agent_id,task.revision,
          task.updated_at,task.conversation_id,conversation.project_id
        FROM task JOIN conversation ON conversation.id=task.conversation_id
        WHERE conversation.project_id IS NOT NULL
      `).all() as Array<Record<string, unknown>>;
      for (const task of tasks) this.project({
        conversationKey: `work:${task.id}`,
        kind: 'work', projectId: String(task.project_id),
        subject: { type: 'work', id: String(task.id) },
        actor: { type: task.agent_id ? 'agent' : 'system', id: String(task.agent_id ?? 'team') },
        title: String(task.title), preview: String(task.description ?? ''),
        actionState: task.status === 'blocked' ? 'needs_action' : ['done', 'cancelled'].includes(String(task.status)) ? 'resolved' : 'informational',
        latestEventId: `task:${task.id}:r${task.revision}`,
        latestAt: String(task.updated_at), metadata: { status: task.status, conversationId: task.conversation_id },
      });

      const reviews = db.prepare(`
        SELECT id,project_id,title,description,status,revision,updated_at,base_ref,compare_ref
        FROM project_review
      `).all() as Array<Record<string, unknown>>;
      for (const review of reviews) this.project({
        conversationKey: `review:${review.id}`,
        kind: 'review', projectId: String(review.project_id),
        subject: { type: 'review', id: String(review.id) },
        actor: { type: 'system', id: 'review' },
        title: String(review.title), preview: String(review.description ?? ''),
        actionState: ['open', 'changes_requested'].includes(String(review.status)) ? 'needs_action' : 'resolved',
        latestEventId: `review:${review.id}:r${review.revision}`,
        latestAt: String(review.updated_at),
        metadata: { status: review.status, baseRef: review.base_ref, compareRef: review.compare_ref },
      });

      const excludedMessageTypes = RUNTIME_OBSERVATION_CONTENT_TYPES.map(() => '?').join(',');
      const messages = db.prepare(`
        SELECT message.*,conversation.project_id,conversation.title scope_title
        FROM chat_message message JOIN conversation ON conversation.id=message.conversation_id
        WHERE conversation.project_id IS NOT NULL
          AND message.visibility='public' AND message.sender_type IN ('human','agent')
          AND message.content_type NOT IN (${excludedMessageTypes})
          AND NOT (
            message.sender_type='agent'
            AND message.invocation_id IS NOT NULL
            AND message.content LIKE ?
          )
        ORDER BY message.created_at,message.id
      `).all(...RUNTIME_OBSERVATION_CONTENT_TYPES, LEGACY_RUNTIME_FAILURE_PREFIX) as Array<Record<string, unknown>>;
      const latestByThread = new Map<string, Record<string, unknown>>();
      for (const message of messages) {
        const metadata = parseObject(typeof message.metadata === 'string' ? message.metadata : null);
        const root = threadRoot(metadata, message.sender_type === 'agent' && message.invocation_id ? `invocation:${message.invocation_id}` : String(message.id));
        const key = `message:${message.conversation_id}:${root}`;
        latestByThread.set(key, message);
      }
      // Project only the final message of each thread. Replaying every older
      // segment on each refresh incorrectly advances revision/unread counters.
      for (const [key, message] of latestByThread) {
        const existing = db.prepare('SELECT 1 FROM workspace_inbox_item WHERE conversation_key=?').get(key);
        const legacySources = !existing ? messages.filter((source) => {
          const metadata = parseObject(typeof source.metadata === 'string' ? source.metadata : null);
          const root = threadRoot(metadata, source.sender_type === 'agent' && source.invocation_id ? `invocation:${source.invocation_id}` : String(source.id));
          return key === `message:${source.conversation_id}:${root}`;
        }).map((source) => db.prepare("SELECT unread_count,read_at FROM workspace_inbox_item WHERE kind='message_thread' AND latest_event_id=?")
          .get(String(source.id)) as { unread_count: number; read_at: string | null } | undefined) : [];
        const metadata = parseObject(typeof message.metadata === 'string' ? message.metadata : null);
        const root = threadRoot(metadata, message.sender_type === 'agent' && message.invocation_id ? `invocation:${message.invocation_id}` : String(message.id));
        this.project({
          conversationKey: key,
          kind: 'message_thread', projectId: String(message.project_id),
          subject: { type: 'message_thread', id: root },
          actor: { type: String(message.sender_type), id: String(message.sender_id) },
          title: String(message.scope_title || '项目讨论'),
          preview: String(message.content),
          latestEventId: String(message.id), latestAt: String(message.created_at),
          metadata: { ...metadata, conversationId: message.conversation_id, messageId: String(message.id) },
        });
        if (legacySources.length && legacySources.every((source) => source && source.unread_count === 0 && source.read_at)) {
          this.markRead(key, legacySources.map((source) => source!.read_at!).sort().at(-1)!);
        }
      }

      // Remove pre-grouping rows only after their eligible source messages have
      // been projected above. Current invocation/thread rows remain intact.
      for (const message of messages) {
        const metadata = parseObject(typeof message.metadata === 'string' ? message.metadata : null);
        const root = threadRoot(metadata, message.sender_type === 'agent' && message.invocation_id ? `invocation:${message.invocation_id}` : String(message.id));
        db.prepare("DELETE FROM workspace_inbox_item WHERE kind='message_thread' AND latest_event_id=? AND conversation_key<>?").run(String(message.id), `message:${message.conversation_id}:${root}`);
      }

      // Runtime observations remain canonical chat trace rows, but they are not
      // user-facing Inbox facts. Reconciliation also removes rows projected by
      // older builds. If an observation had advanced a real message thread, the
      // ordered eligible-message pass above restores that thread first.
      db.prepare(`
        DELETE FROM workspace_inbox_item
        WHERE kind='message_thread' AND latest_event_id IN (
          SELECT id FROM chat_message
          WHERE content_type IN (${excludedMessageTypes})
            OR (
              sender_type='agent'
              AND invocation_id IS NOT NULL
              AND content LIKE ?
            )
        )
      `).run(...RUNTIME_OBSERVATION_CONTENT_TYPES, LEGACY_RUNTIME_FAILURE_PREFIX);
    })();
  }

  list(filter: WorkspaceInboxFilter = 'all', limit = 100): WorkspaceInboxItem[] {
    const where = filter === 'needs_action' ? "item.action_state='needs_action'"
      : filter === 'agents' ? "item.actor_type='agent'"
        : filter === 'reviews' ? "item.kind='review'" : '1=1';
    const rows = this.db().prepare(`
      SELECT item.*,project.name project_name
      FROM workspace_inbox_item item LEFT JOIN project ON project.id=item.project_id
      WHERE ${where}
      ORDER BY CASE item.action_state WHEN 'needs_action' THEN 0 ELSE 1 END,item.latest_at DESC,item.conversation_key
      LIMIT ?
    `).all(Math.max(1, Math.min(500, limit))) as InboxRow[];
    return rows.map(hydrate);
  }

  markRead(conversationKey: string, readAt = new Date().toISOString()): boolean {
    return this.db().prepare(`
      UPDATE workspace_inbox_item SET read_at=?,unread_count=0,updated_at=?
      WHERE conversation_key=?
    `).run(readAt, readAt, conversationKey).changes === 1;
  }
}

export const workspaceInboxRepo = new WorkspaceInboxRepository();
