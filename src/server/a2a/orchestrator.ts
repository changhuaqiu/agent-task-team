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
import { findUnresolvedMentionTokens } from './scanner';
import { scanPassIntents } from './pass-intent';
import { buildHandoffPacketDraft } from './handoff-packet';
import { PossessionRepo } from './possession';

const MIN_SUBSTANTIVE_LENGTH = 30;

export interface OrchestratorConfig {
  getTasksForConversation: (conversationId: string) => TaskSummary[];
  getCommunicationPolicy?: (conversationId: string) => CommunicationPolicy | undefined;
  getAgentMentionConfigs?: (conversationId: string) => AgentMentionConfig[] | undefined;
}

export class Orchestrator {
  private chainRepo: ChainRepo;
  private possessionRepo: PossessionRepo;
  private cursorRepo: CursorRepo;
  private agents: AgentMentionConfig[];
  private agentStates: Map<string, AgentState> = new Map();
  private chainTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private entryPassIds: Map<string, string> = new Map();
  private config: OrchestratorConfig;

  constructor(
    private db: Database.Database,
    private io: IOServer,
    agentConfigs: AgentMentionConfig[],
    config: OrchestratorConfig,
  ) {
    this.chainRepo = new ChainRepo(db);
    this.possessionRepo = new PossessionRepo(db);
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
    this.possessionRepo.abortActiveByConversation(trigger.conversationId, 'new_chain_created');

    const chain = this.chainRepo.create(trigger);
    this.possessionRepo.createChain({
      id: chain.id,
      conversationId: trigger.conversationId,
      rootTriggerType: trigger.type === 'user_message' ? 'user_turn' : 'scheduled',
      rootTriggerId: trigger.messageId,
      currentHolderId: 'user',
      config: chain.config as unknown as Record<string, unknown>,
    });
    this.audit('chain_created', { chainId: chain.id, conversationId: chain.conversationId });

    // Start timeout timer
    this.startChainTimer(chain);

    return chain;
  }

  getActiveChain(conversationId: string): InvocationChain | null {
    return this.chainRepo.getActiveByConversation(conversationId);
  }

  abortActiveChains(conversationId: string, reason: string): number {
    const aborted = this.chainRepo.abortAllActive(conversationId);
    const possessionAborted = this.possessionRepo.abortActiveByConversation(conversationId, reason);
    if (aborted > 0) {
      this.audit('chain_aborted', { conversationId, reason });
    }
    return Math.max(aborted, possessionAborted);
  }

  // ──────────────────────────────────────────────
  // Dispatch decision
  // ──────────────────────────────────────────────

  requestDispatch(req: DispatchRequest): DispatchDecision {
    const chain = this.chainRepo.getById(req.chainId);
    if (!chain || chain.status !== 'active') {
      return { allow: false, reason: 'chain not active or not found', silent: true };
    }

    const elapsedMs = Date.now() - new Date(chain.createdAt).getTime();
    if (elapsedMs > chain.config.maxDurationMs) {
      const reason = `chain ${chain.id} exceeded max duration (${elapsedMs}ms > ${chain.config.maxDurationMs}ms)`;
      this.chainRepo.abort(chain.id, 'timeout');
      this.possessionRepo.timeoutChain(chain.id, 'run', reason);
      this.clearChainTimer(chain.id);
      clearRippleForChain(chain.id);
      this.audit('chain_timeout', { chainId: chain.id, conversationId: chain.conversationId, reason });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, reason, 'timeout');
      return { allow: false, reason, silent: false };
    }

    const possessionChain = this.possessionRepo.getById(chain.id);
    if (!possessionChain || possessionChain.status !== 'active') {
      return { allow: false, reason: 'possession chain not active or not found', silent: true };
    }
    if (possessionChain.currentHolderId !== req.fromAgentId) {
      const reason = `当前持球者是 ${possessionChain.currentHolderId}，${req.fromAgentId} 不能转交`;
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: 'holder',
        reason,
      });
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason,
        metadata: { blockedBy: 'current_holder' },
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, reason);
      return { allow: false, reason, silent: false };
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
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: 'budget',
        reason: `depth ${req.depth} exceeds chain max ${chain.config.maxDepth}`,
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, `depth ${req.depth} exceeds chain max ${chain.config.maxDepth}`);
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
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: 'policy',
        reason,
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, reason);
      return { allow: false, reason, silent: false };
    }

    // Breadth check
    const worklist = this.chainRepo.getWorklistForChain(chain.id);
    const uniqueAgents = new Set(worklist.map(e => e.agentId));
    if (!uniqueAgents.has(req.toAgentId) && uniqueAgents.size >= chain.config.maxBreadth) {
      const reason = `chain breadth limit reached (${chain.config.maxBreadth} agents)`;
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: 'budget',
        reason,
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, reason);
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
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: dedupResult.failedLayer === 'chain_lifetime' ? 'run' : 'dedup',
        reason: dedupResult.reason!,
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, dedupResult.reason!);
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
      this.possessionRepo.createBlockedPass({
        chainId: chain.id,
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        intent: req.intent ?? 'delegate',
        phase: 'dedup',
        reason: 'duplicate content in chain',
      });
      this.emitPassBlocked(chain.conversationId, chain.id, req.fromAgentId, req.toAgentId, 'duplicate content in chain');
      return { allow: false, reason: 'duplicate content in chain', silent: true };
    }

    const { pass } = this.possessionRepo.createPass({
      chainId: chain.id,
      fromHolderId: req.fromAgentId,
      toAgentId: req.toAgentId,
      intent: req.intent ?? 'delegate',
      packet: buildHandoffPacketDraft({
        fromHolderId: req.fromAgentId,
        toAgentId: req.toAgentId,
        content: req.content,
        intent: req.intent ?? 'delegate',
      }),
    });
    this.entryPassIds.set(entry.id, pass.id);

    this.audit('dispatch_allowed', {
      chainId: chain.id,
      conversationId: chain.conversationId,
      fromAgentId: req.fromAgentId,
      toAgentId: req.toAgentId,
      contentHash,
      metadata: { passId: pass.id },
    });

    return { allow: true, entry };
  }

  // ──────────────────────────────────────────────
  // Agent response handling
  // ──────────────────────────────────────────────

  onAgentResponse(agentId: string, response: string, conversationId: string): void {
    const chain = this.chainRepo.getActiveByConversation(conversationId);
    if (!chain) return;

    // Find the active entry for this agent. In possession mode an entry may
    // still be dispatching when the first response proves the process started.
    const executingEntry = this.chainRepo.getActiveEntry(chain.id, agentId);
    if (executingEntry) {
      this.markDispatchStarted(chain.id, executingEntry.id, conversationId, agentId);
    }

    const possessionChain = this.possessionRepo.getById(chain.id);
    if (possessionChain && possessionChain.currentHolderId !== agentId) {
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId,
        fromAgentId: agentId,
        reason: `non-holder response ignored; current holder is ${possessionChain.currentHolderId}`,
        metadata: { blockedBy: 'current_holder' },
      });
      return;
    }

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
    const targets = scanPassIntents(response, mentionConfigs, agentId);
    if (targets.length === 0) {
      const unresolvedTokens = findUnresolvedMentionTokens(response, mentionConfigs, agentId);
      for (const token of unresolvedTokens) {
        const reason = `当前团队没有可接收 ${token} 的角色`;
        this.audit('dispatch_blocked', {
          chainId: chain.id,
          conversationId,
          fromAgentId: agentId,
          reason,
          metadata: { blockedBy: 'unknown_mention_target', mention: token },
        });
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 拦截：${reason}`,
          conversationId,
        });
      }
      const hasMention = findUnresolvedMentionTokens(response, [], agentId).length > 0;
      if (hasMention) {
        this.audit('dispatch_blocked', {
          chainId: chain.id,
          conversationId,
          fromAgentId: agentId,
          reason: 'mention_without_pass_intent',
          metadata: { blockedBy: 'pass_intent' },
        });
      }
      this.possessionRepo.completeHolder(chain.id, agentId, response.slice(0, 1000));
      this.tryCompleteChain(chain.id);
      return;
    }

    // Process each mention as a dispatch request
    const currentDepth = executingEntry ? executingEntry.depth : 0;
    for (const target of targets) {
      const decision = this.requestDispatch({
        chainId: chain.id,
        fromAgentId: agentId,
        toAgentId: target.agentId,
        content: target.content,
        depth: currentDepth + 1,
        intent: target.intent,
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
      this.requestDispatch({
        chainId: chain.id,
        fromAgentId: 'user',
        toAgentId: targetAgentId,
        content: prompt,
        depth: 0,
        intent: 'delegate',
      });
      this.dispatchNext(chain.id, conversationId);
    }

    return chain;
  }

  registerExternalUserDispatch(
    conversationId: string,
    messageId: string,
    targetAgentIds: string[],
    prompt: string,
  ): InvocationChain {
    const chain = this.createChain({
      conversationId,
      type: 'user_message',
      messageId,
    });

    for (const targetAgentId of [...new Set(targetAgentIds)]) {
      const contentHash = computeContentHash('user', targetAgentId, prompt);
      const entry = this.chainRepo.appendWorklist(chain.id, targetAgentId, 'user', prompt, contentHash, 0);
      if (!entry) continue;
      if (this.entryPassIds.size === 0 || targetAgentIds[0] === targetAgentId) {
        const { pass } = this.possessionRepo.createPass({
          chainId: chain.id,
          fromHolderId: 'user',
          toAgentId: targetAgentId,
          intent: 'delegate',
          packet: buildHandoffPacketDraft({
            fromHolderId: 'user',
            toAgentId: targetAgentId,
            content: prompt,
            intent: 'delegate',
            sourceMessageIds: [messageId],
          }),
        });
        this.entryPassIds.set(entry.id, pass.id);
        this.possessionRepo.startPass(pass.id);
      } else {
        this.possessionRepo.createBlockedPass({
          chainId: chain.id,
          fromHolderId: 'user',
          toAgentId: targetAgentId,
          intent: 'delegate',
          phase: 'holder',
          reason: '当前持球模型一次只允许交接给一个 agent',
        });
      }
      this.chainRepo.markExecuting(entry.id);
      this.setAgentState(targetAgentId, 'executing', chain.id);
      recordDispatchTime(targetAgentId);
      this.audit('dispatch_allowed', {
        chainId: chain.id,
        conversationId,
        fromAgentId: 'user',
        toAgentId: targetAgentId,
        contentHash,
        metadata: { externalDispatch: true },
      });
    }

    return chain;
  }

  // ──────────────────────────────────────────────
  // Dispatch execution
  // ──────────────────────────────────────────────

  dispatchNext(chainId: string, conversationId: string): void {
    const chain = this.chainRepo.getById(chainId);
    if (!chain || chain.status !== 'active') return;

    let dispatched = false;

    while (true) {
      const next = this.chainRepo.getNextQueued(chainId);
      if (!next) {
        if (!dispatched) this.tryCompleteChain(chainId);
        return;
      }

      // Check if target agent is idle
      const state = this.getAgentState(next.agentId);
      if (state.status !== 'idle') {
        // Agent busy — leave in queue, will be dispatched when agent completes
        return;
      }

      this.chainRepo.markDispatching(next.id);
      this.setAgentState(next.agentId, 'queued', chainId);
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

      const passId = this.entryPassIds.get(next.id)
        ?? this.possessionRepo.findLatestPassForTarget(chainId, next.agentId, ['offered', 'accepted', 'starting'])?.id;

      this.io.emit('a2a:pass-offer', {
        agentId: next.agentId,
        prompt,
        referencedTaskId: undefined,
        fromAgentId: next.requestedBy,
        conversationId,
        chainId,
        entryId: next.id,
        passId,
      });

      // Compatibility event for the current client. The client must ACK with
      // a2a:agent-started before this becomes executing in the possession model.
      this.io.emit('a2a:dispatch', {
        agentId: next.agentId,
        prompt,
        referencedTaskId: undefined,
        fromAgentId: next.requestedBy,
        conversationId,
        chainId,
        entryId: next.id,
        passId,
      });

      dispatched = true;
    }
  }

  markDispatchStarted(
    chainId: string,
    entryId: string,
    conversationId: string,
    agentId: string,
    passId?: string,
  ): void {
    const chain = this.chainRepo.getById(chainId);
    if (!chain || chain.status !== 'active') return;

    this.chainRepo.markExecuting(entryId);
    this.setAgentState(agentId, 'executing', chainId);

    const resolvedPassId = passId
      ?? this.entryPassIds.get(entryId)
      ?? this.possessionRepo.findLatestPassForTarget(chainId, agentId, ['offered', 'accepted', 'starting'])?.id;
    if (resolvedPassId) {
      this.entryPassIds.set(entryId, resolvedPassId);
      this.possessionRepo.startPass(resolvedPassId);
      this.io.emit('a2a:possession-changed', {
        chainId,
        conversationId,
        currentHolderId: agentId,
        passId: resolvedPassId,
      });
    }
  }

  markDispatchFailed(
    chainId: string,
    entryId: string,
    conversationId: string,
    agentId: string,
    reason: string,
  ): void {
    const chain = this.chainRepo.getById(chainId);
    if (!chain || chain.status !== 'active') return;
    this.chainRepo.markDone(entryId, 'error');
    const passId = this.entryPassIds.get(entryId)
      ?? this.possessionRepo.findLatestPassForTarget(chainId, agentId, ['offered', 'accepted', 'starting'])?.id;
    if (passId) this.possessionRepo.updatePassStatus(passId, 'rejected', reason, 'start');
    this.setAgentState(agentId, 'idle');
    this.audit('dispatch_blocked', {
      chainId,
      conversationId,
      toAgentId: agentId,
      reason,
      metadata: { dispatchFailed: true },
    });
    this.emitPassBlocked(conversationId, chainId, undefined, agentId, reason);
    this.dispatchNext(chainId, conversationId);
  }

  // ──────────────────────────────────────────────
  // Chain completion
  // ──────────────────────────────────────────────

  private tryCompleteChain(chainId: string): void {
    const pending = this.chainRepo.getPendingCount(chainId);
    if (pending === 0) {
      this.chainRepo.complete(chainId);
      this.possessionRepo.completeChain(chainId);
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
      this.chainTimers.delete(chain.id);
      const current = this.chainRepo.getById(chain.id);
      if (current && current.status === 'active') {
        this.chainRepo.abort(chain.id, 'timeout');
        this.possessionRepo.timeoutChain(
          chain.id,
          'run',
          `A2A 执行阶段超时 (${chain.config.maxDurationMs / 1000}s)`,
        );
        clearRippleForChain(chain.id);
        this.audit('chain_timeout', { chainId: chain.id, conversationId: chain.conversationId });
        this.io.emit('agent:event', {
          type: 'system',
          content: `A2A 执行阶段超时：当前持球者未在 ${chain.config.maxDurationMs / 1000}s 内完成或交接`,
          conversationId: chain.conversationId,
        });
        this.emitPassBlocked(
          chain.conversationId,
          chain.id,
          current.rootTriggerType,
          current.rootTriggerId,
          `执行阶段超时 (${chain.config.maxDurationMs / 1000}s)`,
          'timeout',
        );
      }
    }, chain.config.maxDurationMs);
    timer.unref?.();

    this.chainTimers.set(chain.id, timer);
  }

  private clearChainTimer(chainId: string): void {
    const timer = this.chainTimers.get(chainId);
    if (timer) {
      clearTimeout(timer);
      this.chainTimers.delete(chainId);
    }
  }

  private emitPassBlocked(
    conversationId: string,
    chainId: string,
    fromAgentId: string | undefined,
    toAgentId: string | undefined,
    reason: string,
    status: 'blocked' | 'timeout' = 'blocked',
  ): void {
    this.io.emit('a2a:pass-blocked', {
      conversationId,
      chainId,
      fromAgentId,
      toAgentId,
      reason,
      status,
    });
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
    this.entryPassIds.clear();
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
      this.possessionRepo.timeoutChain(chain.id, 'run', 'stale active chain expired on startup');
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
