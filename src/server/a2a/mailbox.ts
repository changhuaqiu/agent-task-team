// src/server/a2a/mailbox.ts
import type Database from 'better-sqlite3';
import type { MailboxEntry } from './types';

interface InsertParams {
  id: string;
  conversationId: string;
  fromAgentId: string;
  toAgentId: string;
  triggerMessageId?: string;
  taskId?: string;
  content: string;
  contextSnapshot?: string;
  status: MailboxEntry['status'];
  chainDepth: number;
  a2aFrom?: string;
  source: string;
  createdAt: string;
}

export class MailboxRepo {
  constructor(private db: Database.Database) {}

  insert(params: InsertParams): void {
    this.db.prepare(`
      INSERT INTO agent_mailbox (id, conversation_id, from_agent_id, to_agent_id,
        trigger_message_id, task_id, content, context_snapshot, status, chain_depth,
        a2a_from, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.id, params.conversationId, params.fromAgentId, params.toAgentId,
      params.triggerMessageId ?? null, params.taskId ?? null, params.content,
      params.contextSnapshot ?? null, params.status, params.chainDepth,
      params.a2aFrom ?? null, params.source, params.createdAt,
    );
  }

  findPending(agentId: string): MailboxEntry[] {
    return this.db.prepare(`
      SELECT * FROM agent_mailbox
      WHERE to_agent_id = ? AND status = 'pending'
      ORDER BY created_at ASC
    `).all(agentId) as MailboxEntry[];
  }

  updateStatus(id: string, status: MailboxEntry['status']): void {
    const deliveredAt = status === 'delivered' ? new Date().toISOString() : null;
    this.db.prepare(`
      UPDATE agent_mailbox SET status = ?, delivered_at = COALESCE(?, delivered_at)
      WHERE id = ?
    `).run(status, deliveredAt, id);
  }

  expireStale(maxAgeMs: number): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db.prepare(`
      UPDATE agent_mailbox SET status = 'expired'
      WHERE status = 'pending' AND created_at < ?
    `).run(cutoff);
    return result.changes;
  }
}
