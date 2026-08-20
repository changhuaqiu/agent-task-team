import type Database from 'better-sqlite3';
import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';
import { messageToTeamLogEntry, teamLogProjection } from '../team-log/TeamLogProjection';

export interface MessageRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  sender_type: string;
  sender_id: string;
  content: string;
  content_type: string;
  mentions: string | null;
  intent: string | null;
  metadata: string | null;
  visibility: string;
  invocation_id: string | null;
  created_at: string;
}

export interface NewMessage {
  conversationId: string;
  taskId?: string;
  senderType: 'human' | 'agent' | 'system';
  senderId: string;
  content: string;
  contentType?: string;
  mentions?: string[];
  intent?: string;
  metadata?: Record<string, unknown>;
  visibility?: string;
  invocationId?: string;
  projectTeamLog?: boolean;
}

export const messageRepo = {
  append(input: NewMessage, database: Database.Database = getDb()): string {
    const id = generateSortableId('msg');
    const now = new Date().toISOString();
    database
      .prepare(
        `INSERT INTO chat_message (id, conversation_id, task_id, sender_type, sender_id, content, content_type, mentions, intent, metadata, visibility, invocation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.conversationId,
        input.taskId ?? null,
        input.senderType,
        input.senderId,
        input.content,
        input.contentType ?? 'text',
        input.mentions ? JSON.stringify(input.mentions) : null,
        input.intent ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.visibility ?? 'public',
        input.invocationId ?? null,
        now,
      );
    const entry = messageToTeamLogEntry({
      id,
      conversation_id: input.conversationId,
      task_id: input.taskId ?? null,
      sender_type: input.senderType,
      sender_id: input.senderId,
      content: input.content,
      content_type: input.contentType ?? 'text',
      mentions: input.mentions ? JSON.stringify(input.mentions) : null,
      intent: input.intent ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
      visibility: input.visibility ?? 'public',
      invocation_id: input.invocationId ?? null,
      created_at: now,
    });
    if (entry && input.projectTeamLog !== false) teamLogProjection.append(entry);
    return id;
  },

  getById(id: string): MessageRow | undefined {
    return getDb().prepare('SELECT * FROM chat_message WHERE id = ?').get(id) as MessageRow | undefined;
  },

  getByConversation(
    convId: string,
    options?: { limit?: number; cursor?: string },
  ): MessageRow[] {
    const limit = options?.limit ?? 50;
    if (options?.cursor) {
      return getDb()
        .prepare(
          'SELECT * FROM chat_message WHERE conversation_id = ? AND id > ? ORDER BY created_at ASC, id ASC LIMIT ?',
        )
        .all(convId, options.cursor, limit) as MessageRow[];
    }
    return getDb()
      .prepare(
        'SELECT * FROM chat_message WHERE conversation_id = ? ORDER BY created_at ASC, id ASC LIMIT ?',
      )
        .all(convId, limit) as MessageRow[];
  },

  getLatestByConversation(convId: string, options?: { limit?: number }): MessageRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare(
        `SELECT * FROM (
          SELECT * FROM chat_message
          WHERE conversation_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        )
        ORDER BY created_at ASC, id ASC`,
      )
      .all(convId, limit) as MessageRow[];
  },

  getLatestPageByConversation(
    convId: string,
    options: {
      limit: number;
      before?: { createdAt: string; id: string };
    },
  ): MessageRow[] {
    if (options.before) {
      return getDb()
        .prepare(
          `SELECT * FROM (
            SELECT * FROM chat_message
            WHERE conversation_id = ?
              AND (created_at < ? OR (created_at = ? AND id < ?))
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )
          ORDER BY created_at ASC, id ASC`,
        )
        .all(
          convId,
          options.before.createdAt,
          options.before.createdAt,
          options.before.id,
          options.limit,
        ) as MessageRow[];
    }
    return this.getLatestByConversation(convId, { limit: options.limit });
  },

  getByConversationAgent(convId: string, agentId: string, options?: { limit?: number }): MessageRow[] {
    const limit = options?.limit ?? 10;
    return getDb()
      .prepare(`SELECT * FROM chat_message
        WHERE conversation_id = ? AND sender_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(convId, agentId, limit)
      .reverse() as MessageRow[];
  },

};
