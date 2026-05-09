// src/server/a2a/orchestrator.ts
import type Database from 'better-sqlite3';
import type { Server as IOServer } from 'socket.io';
import type {
  CommunicationPolicy,
} from '@/lib/team-runtime';
import type {
  InvocationChain,
  WorklistEntry,
  ChainTrigger,
  DispatchRequest,
  DispatchDecision,
  AgentState,
  AgentRunState,
  AgentMentionConfig,
  AuditEventType,
  TaskSummary,
} from './types-v2';
import { ChainRepo } from './chain';
import { CursorRepo } from './cursor';
import { computeContentHash, runAllDedupLayers, recordDispatchTime, clearRippleForChain, resetAllDedupState } from './dedup';
import { buildDispatchContext, renderDispatchPrompt } from './context-builder';
import { scanMentions, extractMentionContent } from './scanner';

const MIN_SUBSTANTIVE_LENGTH = 30;

export interface OrchestratorConfig {
  getTasksForConversation: (conversationId: string) => TaskSummary[];
  getCommunicationPolicy?: (conversationId: string) => CommunicationPolicy | undefined;
  getAgentMentionConfigs?: (conversationId: string) => AgentMentionConfig[] | undefined;
}

export class Orchestrator {
  private chainRepo: ChainRepo;
  private cursorRepo: CursorRepo;
  private agents: AgentMentionConfig[];
  private agentStates: Map<string, AgentState> = new Map();
  private chainTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private config: OrchestratorConfig;

  constructor(
    private db: Database.Database,
    private io: IOServer,
    agentConfigs: AgentMentionConfig[],
    config: OrchestratorConfig,
  ) {
    this.chainRepo = new ChainRepo(db);
    this.cursorRepo = new CursorRepo(db);
    this.agents = agentConfigs;
    this.config = config;
  }

  // ──────────────────────────────────────────────
  // Chain lifecycle
  // ──────────────────────────────────────────────

  createChain(trigger: ChainTrigger): InvocationChain {
    // Abort any active chains for this conversation (new user message = new chain)
    const aborted = this.chainRepo.abortAllActive(trigger.conversationId);
    if (aborted > 0) {
      this.audit('chain_aborted', { conversationId: trigger.conversationId, reason: 'new_chain_created' });
    }

    const chain = this.chainRepo.create(trigger);
    this.audit('chain_created', { chainId: chain.id, conversationId: chain.conversationId });

    // Start timeout timer
    this.startChainTimer(chain);

    return chain;
  }

  getActiveChain(conversationId: string): InvocationChain | null {
    return this.chainRepo.getActiveByConversation(conversationId);
  }

  // ──────────────────────────────────────────────
  // Dispatch decision
  // ──────────────────────────────────────────────

  requestDispatch(req: DispatchRequest): DispatchDecision {
    const chain = this.chainRepo.getById(req.chainId);
    if (!chain || chain.status !== 'active') {
      return { allow: false, reason: 'chain not active or not found', silent: true };
    }

    // Depth check
    if (req.depth > chain.config.maxDepth) {
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason: `depth ${req.depth} exceeds max ${chain.config.maxDepth}`,
      });
      return { allow: false, reason: `depth ${req.depth} exceeds chain max ${chain.config.maxDepth}`, silent: false };
    }

    const policy = this.config.getCommunicationPolicy?.(chain.conversationId);
    if (req.fromAgentId !== 'user' && policy && !policy.canSend(req.fromAgentId, req.toAgentId)) {
      const reason = policy.explainBlock(req.fromAgentId, req.toAgentId) ?? '团队协作规则阻止了这次转交';
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason,
        metadata: { blockedBy: 'communication_policy' },
      });
      return { allow: false, reason, silent: false };
    }

    // Breadth check
    const worklist = this.chainRepo.getWorklistForChain(chain.id);
    const uniqueAgents = new Set(worklist.map(e => e.agentId));
    if (!uniqueAgents.has(req.toAgentId) && uniqueAgents.size >= chain.config.maxBreadth) {
      return { allow: false, reason: `chain breadth limit reached (${chain.config.maxBreadth} agents)`, silent: false };
    }

    // Run five-layer dedup
    const dedupResult = runAllDedupLayers(this.chainRepo, chain, req);
    if (!dedupResult.pass) {
      if (dedupResult.failedLayer === 'chain_lifetime') {
        this.chainRepo.abort(chain.id, 'timeout');
        this.clearChainTimer(chain.id);
        clearRippleForChain(chain.id);
      }
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason: `${dedupResult.failedLayer}: ${dedupResult.reason}`,
      });
      return { allow: false, reason: dedupResult.reason!, silent: dedupResult.failedLayer === 'rate_limit' };
    }

    // All checks passed — append to worklist
    const contentHash = computeContentHash(req.fromAgentId, req.toAgentId, req.content);
    const entry = this.chainRepo.appendWorklist(
      chain.id, req.toAgentId, req.fromAgentId, req.content, contentHash, req.depth,
    );

    if (!entry) {
      // Content hash collision (Layer 1 at DB level)
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        contentHash,
        reason: 'content_hash_duplicate',
      });
      return { allow: false, reason: 'duplicate content in chain', silent: true };
    }

    this.audit('dispatch_allowed', {
      chainId: chain.id,
      conversationId: chain.conversationId,
      fromAgentId: req.fromAgentId,
      toAgentId: req.toAgentId,
      contentHash,
    });

    return { allow: true, entry };
  }

  // ──────────────────────────────────────────────
  // Agent response handling
  // ──────────────────────────────────────────────

  onAgentResponse(agentId: string, response: string, conversationId: string): void {
    const chain = this.chainRepo.getActiveByConversation(conversationId);
    if (!chain) return;

    // Find the executing entry for this agent
    const executingEntry = this.chainRepo.getExecutingEntry(chain.id, agentId);

    // Mark done if found
    if (executingEntry) {
      this.chainRepo.markDone(executingEntry.id, 'success');
      this.cursorRepo.advance(agentId, conversationId, chain.id, executingEntry.id);
      this.audit('cursor_advanced', { chainId: chain.id, conversationId, fromAgentId: agentId });
    }

    // Update agent state
    this.setAgentState(agentId, 'idle');

    // Don't scan short responses for @mentions (anti-ack)
    const hasToolUse = response.includes('tool_use');
    if (!hasToolUse && response.length < MIN_SUBSTANTIVE_LENGTH) {
      this.tryCompleteChain(chain.id);
      return;
    }

    // Scan against the conversation runtime roster when available.
    const mentionConfigs = this.config.getAgentMentionConfigs?.(conversationId) ?? this.agents;
    const targets = scanMentions(response, mentionConfigs, agentId);
    if (targets.length === 0) {
      this.tryCompleteChain(chain.id);
      return;
    }

    // Process each mention as a dispatch request
    const currentDepth = executingEntry ? executingEntry.depth : 0;
    for (const target of targets) {
      const content = extractMentionContent(response, target);
      const decision = this.requestDispatch({
        chainId: chain.id,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        content,
        depth: currentDepth + 1,
      });

      if (!decision.allow && !decision.silent) {
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 拦截：${decision.reason}`,
          conversationId,
        });
      }
    }

    // Dispatch next in worklist
    this.dispatchNext(chain.id, conversationId);
  }

  // Called when user sends a new message — creates chain and optionally dispatches
  onUserMessage(conversationId: string, messageId: string, targetAgentId?: string, prompt?: string): InvocationChain {
    const chain = this.createChain({
      conversationId,
      type: 'user_message',
      messageId,
    });

    // If there's a direct target (user @mentioned an agent), add to worklist
    if (targetAgentId && prompt) {
      const contentHash = computeContentHash('user', targetAgentId, prompt);
      this.chainRepo.appendWorklist(chain.id, targetAgentId, 'user', prompt, contentHash, 0);
      this.dispatchNext(chain.id, conversationId);
    }

    return chain;
  }

  // ──────────────────────────────────────────────
  // Dispatch execution
  // ──────────────────────────────────────────────

  dispatchNext(chainId: string, conversationId: string): void {
    const chain = this.chainRepo.getById(chainId);
    if (!chain || chain.status !== 'active') return;

    const next = this.chainRepo.getNextQueued(chainId);
    if (!next) {
      this.tryCompleteChain(chainId);
      return;
    }

    // Check if target agent is idle
    const state = this.getAgentState(next.agentId);
    if (state.status !== 'idle') {
      // Agent busy — leave in queue, will be dispatched when agent completes
      return;
    }

    // Mark as dispatching
    this.chainRepo.markDispatching(next.id);
    this.setAgentState(next.agentId, 'executing', chainId);
    recordDispatchTime(next.agentId);

    // Build context
    const ctx = buildDispatchContext(
      {
        chainRepo: this.chainRepo,
        cursorRepo: this.cursorRepo,
        getTasksForAgent: (convId, agentId) => {
          const allTasks = this.config.getTasksForConversation(convId);
          return allTasks.filter(t => t.agentId === agentId || t.status === 'doing');
        },
        getOtherExecutingTasks: (convId, excludeAgentId) => {
          const allTasks = this.config.getTasksForConversation(convId);
          return allTasks.filter(t => t.agentId !== excludeAgentId && t.status === 'doing');
        },
      },
      next,
      conversationId,
    );
    const prompt = renderDispatchPrompt(ctx);

    // Mark executing
    this.chainRepo.markExecuting(next.id);

    // Emit dispatch event
    this.io.emit('a2a:dispatch', {
      agentId: next.agentId,
      prompt,
      referencedTaskId: undefined,
      fromAgentId: next.requestedBy,
      conversationId,
      chainId,
      entryId: next.id,
    });
  }

  // ──────────────────────────────────────────────
  // Chain completion
  // ──────────────────────────────────────────────

  private tryCompleteChain(chainId: string): void {
    const pending = this.chainRepo.getPendingCount(chainId);
    if (pending === 0) {
      this.chainRepo.complete(chainId);
      this.clearChainTimer(chainId);
      clearRippleForChain(chainId);
      this.audit('chain_completed', { chainId, conversationId: '' });
    }
  }

  // ──────────────────────────────────────────────
  // Timeout management
  // ──────────────────────────────────────────────

  private startChainTimer(chain: InvocationChain): void {
    const timer = setTimeout(() => {
      const current = this.chainRepo.getById(chain.id);
      if (current && current.status === 'active') {
        this.chainRepo.abort(chain.id, 'timeout');
        clearRippleForChain(chain.id);
        this.audit('chain_timeout', { chainId: chain.id, conversationId: chain.conversationId });
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 链超时终止 (${chain.config.maxDurationMs / 1000}s)`,
          conversationId: chain.conversationId,
        });
      }
    }, chain.config.maxDurationMs);

    this.chainTimers.set(chain.id, timer);
  }

  private clearChainTimer(chainId: string): void {
    const timer = this.chainTimers.get(chainId);
    if (timer) {
      clearTimeout(timer);
      this.chainTimers.delete(chainId);
    }
  }

  // ──────────────────────────────────────────────
  // Agent state tracking
  // ──────────────────────────────────────────────

  getAgentState(agentId: string): AgentState {
    return this.agentStates.get(agentId) ?? { status: 'idle' };
  }

  setAgentState(agentId: string, status: AgentRunState, chainId?: string): void {
    const current = this.agentStates.get(agentId) ?? { status: 'idle' };
    this.agentStates.set(agentId, {
      ...current,
      status,
      currentChainId: chainId ?? current.currentChainId,
      lastCompletedAt: status === 'idle' ? new Date().toISOString() : current.lastCompletedAt,
    });
  }

  // Notify orchestrator that an agent finished (called by daemon on 'done' event)
  onAgentDone(agentId: string, conversationId: string): void {
    this.setAgentState(agentId, 'idle');

    // Check if there's a queued entry in any active chain for this agent
    const chain = this.chainRepo.getActiveByConversation(conversationId);
    if (chain) {
      this.dispatchNext(chain.id, conversationId);
    }
  }

  // ──────────────────────────────────────────────
  // Reset (for testing)
  // ──────────────────────────────────────────────

  reset(): void {
    this.agentStates.clear();
    for (const timer of this.chainTimers.values()) clearTimeout(timer);
    this.chainTimers.clear();
    resetAllDedupState();
  }

  // ──────────────────────────────────────────────
  // Stale chain cleanup (call periodically or on startup)
  // ──────────────────────────────────────────────

  expireStaleChains(): number {
    const maxAge = 5 * 60 * 1000; // 5 minutes (much shorter than old 30min)
    const stale = this.chainRepo.getExpiredChains(maxAge);
    for (const chain of stale) {
      this.chainRepo.abort(chain.id, 'timeout');
      this.clearChainTimer(chain.id);
      clearRippleForChain(chain.id);
    }
    return stale.length;
  }

  // ──────────────────────────────────────────────
  // Audit log
  // ──────────────────────────────────────────────

  private audit(eventType: AuditEventType, params: {
    chainId?: string;
    conversationId?: string;
    fromAgentId?: string;
    toAgentId?: string;
    contentHash?: string;
    reason?: string;
    metadata?: any;
  }): void {
    const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      this.db.prepare(`
        INSERT INTO a2a_audit_log (id, chain_id, conversation_id, event_type, from_agent_id, to_agent_id, content_hash, reason, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        params.chainId ?? null,
        params.conversationId ?? '',
        eventType,
        params.fromAgentId ?? null,
        params.toAgentId ?? null,
        params.contentHash ?? null,
        params.reason ?? null,
        params.metadata ? JSON.stringify(params.metadata) : null,
        new Date().toISOString(),
      );
    } catch {
      // Audit log failures are non-fatal
    }
  }
}
