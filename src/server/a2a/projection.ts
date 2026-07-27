import type Database from 'better-sqlite3';
import type {
  A2AProjectionChainStatus,
  A2AProjectionPassStatus,
  A2AProjectionSnapshot,
} from '@/shared/project-view-events';
import { getDb } from '../db';

interface ChainRow {
  id: string;
  conversation_id: string;
  status: A2AProjectionChainStatus;
  revision: number;
  updated_at: string;
}

interface HolderRow {
  holder_id: string;
}

interface PassRow {
  id: string;
  chain_id: string;
  from_holder_id: string;
  to_agent_id: string;
  status: A2AProjectionPassStatus;
  intent: string;
  reason: string | null;
  phase: string | null;
  title: string | null;
  updated_at: string;
}

const HOLDER_ACTIVE_STATES = [
  'open',
  'handoff_drafted',
  'handoff_offered',
  'handoff_accepted',
  'handoff_started',
] as const;

/**
 * Read-only A2A projection. It derives presentation state from the single
 * A2ACollaboration aggregate and never participates in command handling.
 */
export class A2AReadModelProjection {
  constructor(private readonly database?: Database.Database) {}

  build(conversationId: string): A2AProjectionSnapshot | undefined {
    const db = this.database ?? getDb();
    const chain = db.prepare(`
      SELECT id,conversation_id,status,revision,updated_at
      FROM a2a_possession_chain
      WHERE conversation_id=?
      ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END,created_at DESC,id DESC
      LIMIT 1
    `).get(conversationId) as ChainRow | undefined;
    if (!chain) return undefined;

    const holderPlaceholders = HOLDER_ACTIVE_STATES.map(() => '?').join(',');
    const holders = db.prepare(`
      SELECT holder_id
      FROM a2a_possession
      WHERE chain_id=? AND status IN (${holderPlaceholders})
      ORDER BY started_at,id
    `).all(chain.id, ...HOLDER_ACTIVE_STATES) as HolderRow[];

    const passes = db.prepare(`
      SELECT p.id,p.chain_id,p.from_holder_id,p.to_agent_id,p.status,p.intent,
        p.reason,p.phase,p.updated_at,h.title
      FROM a2a_pass p
      LEFT JOIN a2a_handoff_packet h ON h.pass_id=p.id
      WHERE p.chain_id=? AND p.group_id IS NOT NULL
      ORDER BY p.created_at,p.id
    `).all(chain.id) as PassRow[];

    return {
      conversationId: chain.conversation_id,
      chainId: chain.id,
      revision: chain.revision,
      currentHolderIds: [...new Set(holders.map((holder) => holder.holder_id))],
      status: chain.status,
      updatedAt: chain.updated_at,
      handoffs: passes.slice(-20).map((pass) => ({
        id: pass.id,
        chainId: pass.chain_id,
        passId: pass.id,
        fromAgentId: pass.from_holder_id,
        toAgentId: pass.to_agent_id,
        status: pass.status,
        intent: pass.intent,
        title: pass.title ?? undefined,
        reason: pass.reason ?? undefined,
        phase: pass.phase ?? undefined,
        timestamp: pass.updated_at,
      })),
    };
  }

  list(conversationIds: string[]): A2AProjectionSnapshot[] {
    return conversationIds
      .map((conversationId) => this.build(conversationId))
      .filter((snapshot): snapshot is A2AProjectionSnapshot => Boolean(snapshot));
  }
}
