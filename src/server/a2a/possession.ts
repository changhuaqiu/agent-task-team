import type Database from 'better-sqlite3';
import type {
  A2AHandoffPacket,
  A2APass,
  A2APossession,
  A2APossessionChain,
  PassBlockPhase,
  PassIntent,
  PassStatus,
  PossessionChainStatus,
  PossessionHolderType,
  PossessionStatus,
} from './types-possession';

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PossessionRepo {
  constructor(private db: Database.Database) {}

  createChain(input: {
    id?: string;
    conversationId: string;
    rootTriggerType: 'user_turn' | 'scheduled' | 'system';
    rootTriggerId: string;
    currentHolderId?: string;
    config?: Record<string, unknown>;
  }): A2APossessionChain {
    const id = input.id ?? genId('pchain');
    const now = new Date().toISOString();
    const currentHolderId = input.currentHolderId ?? 'user';
    this.db.prepare(`
      INSERT INTO a2a_possession_chain
        (id, conversation_id, root_trigger_type, root_trigger_id, status, current_holder_id, config, created_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      id,
      input.conversationId,
      input.rootTriggerType,
      input.rootTriggerId,
      currentHolderId,
      JSON.stringify(input.config ?? {}),
      now,
    );
    this.createPossession({ chainId: id, holderId: currentHolderId, holderType: currentHolderId === 'user' ? 'user' : 'agent' });
    return {
      id,
      conversationId: input.conversationId,
      rootTriggerType: input.rootTriggerType,
      rootTriggerId: input.rootTriggerId,
      status: 'active',
      currentHolderId,
      config: input.config ?? {},
      createdAt: now,
    };
  }

  getActiveByConversation(conversationId: string): A2APossessionChain | null {
    const row = this.db.prepare(`
      SELECT * FROM a2a_possession_chain
      WHERE conversation_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `).get(conversationId) as any;
    return row ? this.rowToChain(row) : null;
  }

  getById(chainId: string): A2APossessionChain | null {
    const row = this.db.prepare('SELECT * FROM a2a_possession_chain WHERE id = ?').get(chainId) as any;
    return row ? this.rowToChain(row) : null;
  }

  abortActiveByConversation(conversationId: string, reason: string): number {
    const now = new Date().toISOString();
    const active = this.db.prepare(`
      SELECT id FROM a2a_possession_chain WHERE conversation_id = ? AND status = 'active'
    `).all(conversationId) as Array<{ id: string }>;
    if (active.length === 0) return 0;
    const ids = active.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`
      UPDATE a2a_possession_chain SET status = 'aborted', completed_at = ?
      WHERE id IN (${placeholders})
    `).run(now, ...ids);
    this.db.prepare(`
      UPDATE a2a_possession SET status = 'aborted', completed_at = ?, summary = COALESCE(summary, ?)
      WHERE chain_id IN (${placeholders}) AND status NOT IN ('completed', 'aborted', 'timeout')
    `).run(now, reason, ...ids);
    this.db.prepare(`
      UPDATE a2a_pass SET status = 'blocked', phase = COALESCE(phase, 'holder'), reason = COALESCE(reason, ?), updated_at = ?
      WHERE chain_id IN (${placeholders}) AND status NOT IN ('completed', 'blocked', 'rejected', 'timeout', 'error')
    `).run(reason, now, ...ids);
    return ids.length;
  }

  completeChain(chainId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE a2a_possession_chain SET status = 'completed', completed_at = ?
      WHERE id = ? AND status = 'active'
    `).run(now, chainId);
    this.db.prepare(`
      UPDATE a2a_possession SET status = 'completed', completed_at = COALESCE(completed_at, ?)
      WHERE chain_id = ? AND status = 'open'
    `).run(now, chainId);
  }

  timeoutChain(chainId: string, phase: PassBlockPhase, reason: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE a2a_possession_chain SET status = 'timeout', completed_at = ?
      WHERE id = ? AND status = 'active'
    `).run(now, chainId);
    this.db.prepare(`
      UPDATE a2a_possession SET status = 'timeout', completed_at = COALESCE(completed_at, ?), summary = COALESCE(summary, ?)
      WHERE chain_id = ? AND status NOT IN ('completed', 'aborted', 'timeout')
    `).run(now, reason, chainId);
    this.db.prepare(`
      UPDATE a2a_pass SET status = 'timeout', phase = ?, reason = COALESCE(reason, ?), updated_at = ?
      WHERE chain_id = ? AND status NOT IN ('completed', 'blocked', 'rejected', 'timeout', 'error')
    `).run(phase, reason, now, chainId);
  }

  getOpenPossession(chainId: string): A2APossession | null {
    const row = this.db.prepare(`
      SELECT * FROM a2a_possession
      WHERE chain_id = ? AND status IN ('open', 'handoff_drafted', 'handoff_offered', 'handoff_accepted', 'handoff_started')
      ORDER BY started_at DESC
      LIMIT 1
    `).get(chainId) as any;
    return row ? this.rowToPossession(row) : null;
  }

  getOpenPossessionForHolder(chainId: string, holderId: string): A2APossession | null {
    const row = this.db.prepare(`
      SELECT * FROM a2a_possession
      WHERE chain_id = ?
        AND holder_id = ?
        AND status IN ('open', 'handoff_drafted', 'handoff_offered', 'handoff_accepted', 'handoff_started')
      ORDER BY started_at DESC
      LIMIT 1
    `).get(chainId, holderId) as any;
    return row ? this.rowToPossession(row) : null;
  }

  createPass(input: {
    chainId: string;
    fromHolderId: string;
    toAgentId: string;
    intent: PassIntent;
    packet: Omit<A2AHandoffPacket, 'id' | 'chainId' | 'passId' | 'fromHolderId' | 'toAgentId' | 'createdAt'>;
  }): { pass: A2APass; packet: A2AHandoffPacket } {
    const possession = this.getOpenPossessionForHolder(input.chainId, input.fromHolderId);
    if (!possession) throw new Error(`No open possession for chain ${input.chainId}`);

    const now = new Date().toISOString();
    const passId = genId('pass');
    const packetId = genId('packet');
    this.db.prepare(`
      INSERT INTO a2a_pass
        (id, chain_id, from_possession_id, from_holder_id, to_agent_id, status, intent, handoff_packet_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'offered', ?, ?, ?, ?)
    `).run(passId, input.chainId, possession.id, input.fromHolderId, input.toAgentId, input.intent, packetId, now, now);
    this.db.prepare(`
      INSERT INTO a2a_handoff_packet
        (id, chain_id, pass_id, from_holder_id, to_agent_id, title, requested_action, possession_summary,
         relevant_decisions, evidence_refs, constraints, open_questions, forbidden_behaviors, source_message_ids, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      packetId,
      input.chainId,
      passId,
      input.fromHolderId,
      input.toAgentId,
      input.packet.title,
      input.packet.requestedAction,
      input.packet.possessionSummary,
      JSON.stringify(input.packet.relevantDecisions),
      JSON.stringify(input.packet.evidenceRefs),
      JSON.stringify(input.packet.constraints),
      JSON.stringify(input.packet.openQuestions),
      JSON.stringify(input.packet.forbiddenBehaviors),
      JSON.stringify(input.packet.sourceMessageIds),
      now,
    );
    this.db.prepare(`UPDATE a2a_possession SET status = 'handoff_offered' WHERE id = ?`).run(possession.id);
    return {
      pass: {
        id: passId,
        chainId: input.chainId,
        fromPossessionId: possession.id,
        fromHolderId: input.fromHolderId,
        toAgentId: input.toAgentId,
        status: 'offered',
        intent: input.intent,
        handoffPacketId: packetId,
        createdAt: now,
        updatedAt: now,
      },
      packet: {
        id: packetId,
        chainId: input.chainId,
        passId,
        fromHolderId: input.fromHolderId,
        toAgentId: input.toAgentId,
        createdAt: now,
        ...input.packet,
      },
    };
  }

  createBlockedPass(input: {
    chainId: string;
    fromHolderId: string;
    toAgentId: string;
    intent: PassIntent;
    phase: PassBlockPhase;
    reason: string;
  }): A2APass | null {
    const possession = this.getOpenPossessionForHolder(input.chainId, input.fromHolderId)
      ?? this.getOpenPossession(input.chainId);
    if (!possession) return null;
    const now = new Date().toISOString();
    const id = genId('pass');
    this.db.prepare(`
      INSERT INTO a2a_pass
        (id, chain_id, from_possession_id, from_holder_id, to_agent_id, status, intent, phase, reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'blocked', ?, ?, ?, ?, ?)
    `).run(id, input.chainId, possession.id, input.fromHolderId, input.toAgentId, input.intent, input.phase, input.reason, now, now);
    return {
      id,
      chainId: input.chainId,
      fromPossessionId: possession.id,
      fromHolderId: input.fromHolderId,
      toAgentId: input.toAgentId,
      status: 'blocked',
      intent: input.intent,
      phase: input.phase,
      reason: input.reason,
      createdAt: now,
      updatedAt: now,
    };
  }

  updatePassStatus(passId: string, status: PassStatus, reason?: string, phase?: PassBlockPhase): void {
    this.db.prepare(`
      UPDATE a2a_pass
      SET status = ?, reason = COALESCE(?, reason), phase = COALESCE(?, phase), updated_at = ?
      WHERE id = ?
    `).run(status, reason ?? null, phase ?? null, new Date().toISOString(), passId);
  }

  findLatestPassForTarget(chainId: string, toAgentId: string, statuses: PassStatus[]): A2APass | null {
    const placeholders = statuses.map(() => '?').join(',');
    const row = this.db.prepare(`
      SELECT * FROM a2a_pass
      WHERE chain_id = ? AND to_agent_id = ? AND status IN (${placeholders})
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(chainId, toAgentId, ...statuses) as any;
    return row ? this.rowToPass(row) : null;
  }

  startPass(passId: string): A2APass | null {
    const pass = this.getPass(passId);
    if (!pass) return null;
    if (pass.status === 'started') return pass;
    const now = new Date().toISOString();
    const source = this.getPossession(pass.fromPossessionId);
    if (source) {
      this.db.prepare(`
        UPDATE a2a_possession SET status = 'completed', completed_at = COALESCE(completed_at, ?)
        WHERE id = ?
      `).run(now, source.id);
    }
    this.db.prepare(`
      UPDATE a2a_pass SET status = 'started', updated_at = ?
      WHERE id = ?
    `).run(now, pass.id);
    this.db.prepare(`
      UPDATE a2a_possession_chain SET current_holder_id = ?
      WHERE id = ? AND status = 'active'
    `).run(pass.toAgentId, pass.chainId);
    this.createPossession({ chainId: pass.chainId, holderId: pass.toAgentId, holderType: 'agent' });
    return { ...pass, status: 'started', updatedAt: now };
  }

  completeHolder(chainId: string, holderId: string, summary?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE a2a_possession
      SET status = 'completed', completed_at = COALESCE(completed_at, ?), summary = COALESCE(?, summary)
      WHERE chain_id = ? AND holder_id = ? AND status != 'completed'
    `).run(now, summary ?? null, chainId, holderId);
    this.db.prepare(`
      UPDATE a2a_pass
      SET status = 'completed', updated_at = ?
      WHERE chain_id = ? AND to_agent_id = ? AND status = 'started'
    `).run(now, chainId, holderId);
  }

  getPass(passId: string): A2APass | null {
    const row = this.db.prepare('SELECT * FROM a2a_pass WHERE id = ?').get(passId) as any;
    return row ? this.rowToPass(row) : null;
  }

  private createPossession(input: { chainId: string; holderId: string; holderType: PossessionHolderType }): A2APossession {
    const id = genId('pos');
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO a2a_possession (id, chain_id, holder_id, holder_type, status, started_at)
      VALUES (?, ?, ?, ?, 'open', ?)
    `).run(id, input.chainId, input.holderId, input.holderType, now);
    return { id, chainId: input.chainId, holderId: input.holderId, holderType: input.holderType, status: 'open', startedAt: now };
  }

  private getPossession(possessionId: string): A2APossession | null {
    const row = this.db.prepare('SELECT * FROM a2a_possession WHERE id = ?').get(possessionId) as any;
    return row ? this.rowToPossession(row) : null;
  }

  private rowToChain(row: any): A2APossessionChain {
    return {
      id: row.id,
      conversationId: row.conversation_id,
      rootTriggerType: row.root_trigger_type,
      rootTriggerId: row.root_trigger_id,
      status: row.status as PossessionChainStatus,
      currentHolderId: row.current_holder_id,
      config: row.config ? JSON.parse(row.config) : {},
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private rowToPossession(row: any): A2APossession {
    return {
      id: row.id,
      chainId: row.chain_id,
      holderId: row.holder_id,
      holderType: row.holder_type as PossessionHolderType,
      status: row.status as PossessionStatus,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      summary: row.summary ?? undefined,
    };
  }

  private rowToPass(row: any): A2APass {
    return {
      id: row.id,
      chainId: row.chain_id,
      fromPossessionId: row.from_possession_id,
      fromHolderId: row.from_holder_id,
      toAgentId: row.to_agent_id,
      status: row.status as PassStatus,
      intent: row.intent as PassIntent,
      reason: row.reason ?? undefined,
      phase: row.phase as PassBlockPhase | undefined,
      handoffPacketId: row.handoff_packet_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
