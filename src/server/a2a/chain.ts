// src/server/a2a/chain.ts
import type Database from 'better-sqlite3';
import type {
  InvocationChain,
  WorklistEntry,
  ChainConfig,
  ChainStatus,
  ChainTrigger,
  WorklistStatus,
  WorklistOutcome,
} from './types-v2';
import { DEFAULT_CHAIN_CONFIG } from './types-v2';

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ChainRepo {
  constructor(private db: Database.Database) {}

  create(trigger: ChainTrigger): InvocationChain {
    const id = genId('chain');
    const config: ChainConfig = { ...DEFAULT_CHAIN_CONFIG, ...trigger.config };
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO invocation_chain (id, conversation_id, root_trigger_type, root_trigger_id, status, config, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?)
    `).run(id, trigger.conversationId, trigger.type, trigger.messageId, JSON.stringify(config), now);

    return { id, conversationId: trigger.conversationId, rootTriggerType: trigger.type, rootTriggerId: trigger.messageId, status: 'active', config, createdAt: now };
  }

  getById(id: string): InvocationChain | null {
    const row = this.db.prepare('SELECT * FROM invocation_chain WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToChain(row);
  }

  getActiveByConversation(conversationId: string): InvocationChain | null {
    const row = this.db.prepare(
      `SELECT * FROM invocation_chain WHERE conversation_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`
    ).get(conversationId) as any;
    if (!row) return null;
    return this.rowToChain(row);
  }

  complete(chainId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE invocation_chain SET status = 'completed', completed_at = ? WHERE id = ?`
    ).run(now, chainId);
  }

  abort(chainId: string, status: 'aborted' | 'timeout' = 'aborted'): void {
    const now = new Date().toISOString();
    this.db.prepare(
      `UPDATE invocation_chain SET status = ?, completed_at = ? WHERE id = ? AND status = 'active'`
    ).run(status, now, chainId);
    // Abort all pending worklist entries
    this.db.prepare(
      `UPDATE chain_worklist SET status = 'aborted' WHERE chain_id = ? AND status IN ('queued', 'dispatching')`
    ).run(chainId);
  }

  abortAllActive(conversationId: string): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `UPDATE invocation_chain SET status = 'aborted', completed_at = ? WHERE conversation_id = ? AND status = 'active'`
    ).run(now, conversationId);
    if (result.changes > 0) {
      this.db.prepare(
        `UPDATE chain_worklist SET status = 'aborted'
         WHERE chain_id IN (SELECT id FROM invocation_chain WHERE conversation_id = ? AND status = 'aborted')
         AND status IN ('queued', 'dispatching')`
      ).run(conversationId);
    }
    return result.changes;
  }

  // ── Worklist operations ──

  appendWorklist(chainId: string, agentId: string, requestedBy: string, prompt: string, contentHash: string, depth: number): WorklistEntry | null {
    const id = genId('wl');
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO chain_worklist (id, chain_id, agent_id, requested_by, prompt, content_hash, depth, status, queued_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)
      `).run(id, chainId, agentId, requestedBy, prompt, contentHash, depth, now);
    } catch (err: any) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.message?.includes('UNIQUE constraint')) {
        return null; // content hash duplicate within chain
      }
      throw err;
    }

    return { id, chainId, agentId, requestedBy, prompt, contentHash, depth, status: 'queued', queuedAt: now };
  }

  getNextQueued(chainId: string): WorklistEntry | null {
    const row = this.db.prepare(
      `SELECT * FROM chain_worklist WHERE chain_id = ? AND status = 'queued' ORDER BY queued_at ASC LIMIT 1`
    ).get(chainId) as any;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  markDispatching(entryId: string): void {
    this.db.prepare(
      `UPDATE chain_worklist SET status = 'dispatching', started_at = ? WHERE id = ?`
    ).run(new Date().toISOString(), entryId);
  }

  markExecuting(entryId: string): void {
    this.db.prepare(
      `UPDATE chain_worklist SET status = 'executing', started_at = COALESCE(started_at, ?) WHERE id = ?`
    ).run(new Date().toISOString(), entryId);
  }

  markDone(entryId: string, outcome: WorklistOutcome): void {
    this.db.prepare(
      `UPDATE chain_worklist SET status = 'done', outcome = ?, completed_at = ? WHERE id = ?`
    ).run(outcome, new Date().toISOString(), entryId);
  }

  getWorklistForChain(chainId: string): WorklistEntry[] {
    const rows = this.db.prepare(
      `SELECT * FROM chain_worklist WHERE chain_id = ? ORDER BY queued_at ASC`
    ).all(chainId) as any[];
    return rows.map(r => this.rowToEntry(r));
  }

  getPendingCount(chainId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM chain_worklist WHERE chain_id = ? AND status IN ('queued', 'dispatching', 'executing')`
    ).get(chainId) as any;
    return row?.cnt ?? 0;
  }

  getTotalCount(chainId: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM chain_worklist WHERE chain_id = ?`
    ).get(chainId) as any;
    return row?.cnt ?? 0;
  }

  hasAgentInChain(chainId: string, agentId: string): boolean {
    const row = this.db.prepare(
      `SELECT 1 FROM chain_worklist WHERE chain_id = ? AND agent_id = ? AND status != 'aborted' LIMIT 1`
    ).get(chainId, agentId) as any;
    return !!row;
  }

  getExecutingEntry(chainId: string, agentId: string): WorklistEntry | null {
    const row = this.db.prepare(
      `SELECT * FROM chain_worklist WHERE chain_id = ? AND agent_id = ? AND status = 'executing' LIMIT 1`
    ).get(chainId, agentId) as any;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  // ── Timeout management ──

  getExpiredChains(maxAgeMs: number): InvocationChain[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.db.prepare(
      `SELECT * FROM invocation_chain WHERE status = 'active' AND created_at < ?`
    ).all(cutoff) as any[];
    return rows.map(r => this.rowToChain(r));
  }

  // ── Helpers ──

  private rowToChain(row: any): InvocationChain {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      rootTriggerType: row.root_trigger_type,
      rootTriggerId: row.root_trigger_id,
      status: row.status as ChainStatus,
      config: JSON.parse(row.config),
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private rowToEntry(row: any): WorklistEntry {
    return {
      id: row.id,
      chainId: row.chain_id,
      agentId: row.agent_id,
      requestedBy: row.requested_by,
      prompt: row.prompt,
      contentHash: row.content_hash,
      depth: row.depth,
      status: row.status as WorklistStatus,
      outcome: row.outcome as WorklistOutcome | undefined,
      queuedAt: row.queued_at,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
