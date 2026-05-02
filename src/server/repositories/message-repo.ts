import { getDb } from '../db/index';
import { generateSortableId } from './sortable-id';

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
}

export const messageRepo = {
  append(input: NewMessage): string {
    const id = generateSortableId('msg');
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO chat_message (id, conversation_id, task_id, sender_type, sender_id, content, content_type, mentions, intent, metadata, visibility, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        now,
      );
    return id;
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

  getByTask(taskId: string): MessageRow[] {
    return getDb()
      .prepare('SELECT * FROM chat_message WHERE task_id = ? ORDER BY created_at ASC')
      .all(taskId) as MessageRow[];
  },

  getByAgent(agentId: string, options?: { limit?: number }): MessageRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare('SELECT * FROM chat_message WHERE sender_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(agentId, limit) as MessageRow[];
  },

  countByConversation(convId: string): number {
    const row = getDb()
      .prepare('SELECT COUNT(*) as count FROM chat_message WHERE conversation_id = ?')
      .get(convId) as { count: number };
    return row.count;
  },
};
