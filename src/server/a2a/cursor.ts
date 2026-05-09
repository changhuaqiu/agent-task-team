// src/server/a2a/cursor.ts
import type Database from 'better-sqlite3';
import type { DeliveryCursor } from './types-v2';

export class CursorRepo {
  constructor(private db: Database.Database) {}

  get(agentId: string, conversationId: string): DeliveryCursor | null {
    const row = this.db.prepare(
      `SELECT * FROM delivery_cursor WHERE agent_id = ? AND conversation_id = ?`
    ).get(agentId, conversationId) as any;
    if (!row) return null;
    return {
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      lastChainId: row.last_chain_id ?? undefined,
      lastEntryId: row.last_entry_id ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  advance(agentId: string, conversationId: string, chainId: string, entryId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO delivery_cursor (agent_id, conversation_id, last_chain_id, last_entry_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (agent_id, conversation_id)
      DO UPDATE SET last_chain_id = excluded.last_chain_id, last_entry_id = excluded.last_entry_id, updated_at = excluded.updated_at
    `).run(agentId, conversationId, chainId, entryId, now);
  }

  getEntriesAfterCursor(agentId: string, conversationId: string, currentChainId?: string): { chainId: string; entryId: string; prompt: string; requestedBy: string; completedAt: string }[] {
    const rawCursor = this.get(agentId, conversationId);
    const cursor = currentChainId && rawCursor?.lastChainId !== currentChainId ? null : rawCursor;
    const chainFilter = currentChainId ? 'AND cw.chain_id = ?' : '';

    let query: string;
    let params: any[];

    if (cursor?.lastEntryId) {
      // Get the queued_at of the cursor entry to filter
      const cursorEntry = this.db.prepare(
        `SELECT completed_at FROM chain_worklist WHERE id = ?`
      ).get(cursor.lastEntryId) as any;

      if (cursorEntry?.completed_at) {
        query = `
          SELECT cw.chain_id, cw.id as entry_id, cw.prompt, cw.requested_by, cw.completed_at
          FROM chain_worklist cw
          JOIN invocation_chain ic ON cw.chain_id = ic.id
          WHERE ic.conversation_id = ?
            AND cw.status = 'done'
            AND cw.outcome = 'success'
            AND cw.agent_id != ?
            AND cw.completed_at > ?
            ${chainFilter}
          ORDER BY cw.completed_at ASC
          LIMIT 10
        `;
        params = currentChainId
          ? [conversationId, agentId, cursorEntry.completed_at, currentChainId]
          : [conversationId, agentId, cursorEntry.completed_at];
      } else {
        query = `
          SELECT cw.chain_id, cw.id as entry_id, cw.prompt, cw.requested_by, cw.completed_at
          FROM chain_worklist cw
          JOIN invocation_chain ic ON cw.chain_id = ic.id
          WHERE ic.conversation_id = ?
            AND cw.status = 'done'
            AND cw.outcome = 'success'
            AND cw.agent_id != ?
            ${chainFilter}
          ORDER BY cw.completed_at ASC
          LIMIT 10
        `;
        params = currentChainId ? [conversationId, agentId, currentChainId] : [conversationId, agentId];
      }
    } else {
      // No cursor for this chain — never inject completed entries from older user triggers.
      query = `
        SELECT cw.chain_id, cw.id as entry_id, cw.prompt, cw.requested_by, cw.completed_at
        FROM chain_worklist cw
        JOIN invocation_chain ic ON cw.chain_id = ic.id
        WHERE ic.conversation_id = ?
          AND cw.status = 'done'
          AND cw.outcome = 'success'
          AND cw.agent_id != ?
          ${chainFilter}
        ORDER BY cw.completed_at DESC
        LIMIT 5
      `;
      params = currentChainId ? [conversationId, agentId, currentChainId] : [conversationId, agentId];
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => ({
      chainId: r.chain_id,
      entryId: r.entry_id,
      prompt: r.prompt,
      requestedBy: r.requested_by,
      completedAt: r.completed_at,
    }));
  }
}
