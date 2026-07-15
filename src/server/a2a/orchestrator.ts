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
import type { ChainDedupOptions } from './dedup';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { buildDispatchContext, renderDispatchPrompt } from './context-builder';
import { findUnresolvedMentionTokens, scanMentions } from './scanner';
import { scanPassIntents } from './pass-intent';
import { buildHandoffPacketDraft } from './handoff-packet';
import { PossessionRepo } from './possession';
import { taskGraphRepo } from '../repositories/task-graph-repo';

const MIN_SUBSTANTIVE_LENGTH = 50;
const ACTION_PLACEHOLDER = /^(?:收到|好的?|明白|了解|我看看|稍等|ok(?:ay)?|got it|ack|todo|tbd)[。.!！\s]*$/i;

export function isMissingRequestedAction(content: string | undefined): boolean {
  const text = content?.trim() ?? '';
  return !text || ACTION_PLACEHOLDER.test(text);
}

function hasExplicitNoHandoffLanguage(text: string): boolean {
  return /(不需要|无需|不要|别|不必).*?(转交|交接|唤醒|派发|分配|指派|通知|@)/i.test(text);
}

function hasNotificationStyleMention(text: string): boolean {
  return /(通知|知会|同步给|同步到|抄送|cc|给).*?@[\p{L}\p{N}_-]+/iu.test(text);
}

function formatNonActionableMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `A2A 未转交：${mentionList} 只是提及或通知，没有明确执行动作。下游任务的依赖解除由系统自动调度，无需手动通知。如需主动安排工作，请写成「@agent 请评审/实现/验证 ...」。`;
}

function formatNotificationMentionNotice(tokens: string[]): string {
  const mentionList = tokens.join('、');
  return `群聊知会：${mentionList} 已作为信息接收方出现；这不会启动新的 A2A 执行。依赖解除由系统自动调度；如需主动安排工作，请写成「@agent 请评审/实现/验证 ...」。`;
}

function formatDispatchBlockReason(reason: string): string {
  const agentDedupMatch = reason.match(/^agent\s+([^\s]+)\s+already has an entry in chain/i);
  if (agentDedupMatch) {
    return `@${agentDedupMatch[1]} 已在本轮 A2A 链中，系统不会重复唤醒。下游依赖解除由系统自动调度，无需手动通知；若要追加新工作请等待当前链路结束后再发起。`;
  }
  if (reason.startsWith('direct ping-pong:')) {
    return `检测到来回 @mention 的 ping-pong 风险，系统已阻止这次转交；请把需要执行的下一步写入任务或由统筹重新派发。`;
  }
  if (reason.startsWith('rate limited:')) {
    return `目标 Agent 刚收到过派发，系统暂缓重复唤醒；请等待当前派发完成或稍后重试。`;
  }
  if (reason.includes('reached max dispatches')) {
    return `本轮 A2A 链路已达到最大转交次数，请收束当前任务或让用户/统筹开启新一轮。`;
  }
  return reason;
}

export interface OrchestratorConfig {
  getTasksForConversation: (conversationId: string) => TaskSummary[];
  getCommunicationPolicy?: (conversationId: string) => CommunicationPolicy | undefined;
  getAgentMentionConfigs?: (conversationId: string) => AgentMentionConfig[] | undefined;
  submitDispatch?: (input: {
    conversationId: string;
    agentId: string;
    prompt: string;
    referencedTaskId?: string;
    fromAgentId: string;
    chainId: string;
    entryId: string;
    passId?: string;
  }) => {
    handled: boolean;
    completion: Promise<{ status: 'accepted' | 'deferred' | 'blocked' | 'failed'; reasonCode?: string }>;
  } | undefined;
}

export class Orchestrator {
  private chainRepo: ChainRepo;
  private possessionRepo: PossessionRepo;
  private cursorRepo: CursorRepo;
  private agents: AgentMentionConfig[];
  private agentStates: Map<string, AgentState> = new Map();
  private chainTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private passTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private entryPassIds: Map<string, string> = new Map();
  private entryTaskIds: Map<string, string> = new Map();
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
    this.rebuildStateFromDB();
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
    const missingAction = isMissingRequestedAction(req.content);

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
    if (!this.possessionRepo.getOpenPossessionForHolder(chain.id, req.fromAgentId)) {
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
      const escalationTargetId = policy.getEscalationTarget?.(req.fromAgentId, req.toAgentId);
      const escalatedEntry = escalationTargetId
        ? this.createPolicyEscalationDispatch(chain, req, escalationTargetId, reason)
        : null;
      this.audit('dispatch_blocked', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason,
        metadata: { blockedBy: 'communication_policy', escalatedToAgentId: escalatedEntry?.agentId },
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
      return { allow: false, reason, silent: false, escalatedToAgentId: escalatedEntry?.agentId };
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

    // Run five-layer dedup (coordinators exempt from Layer 2; reject/escalate intents exempt from ping-pong + Layer 2)
    const audience = resolveTaskNotificationAudience(chain.conversationId);
    const dedupOptions: ChainDedupOptions = {
      exemptAgentIds: audience.coordinatorAgentIds,
      exemptIntents: ['reject', 'escalate'],
    };
    const dedupResult = runAllDedupLayers(this.chainRepo, chain, req, dedupOptions);
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
    if (missingAction) {
      this.audit('missing_action', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        reason: 'requested action is empty or placeholder',
        metadata: { passId: pass.id, rawAction: req.content.slice(0, 200) },
      });
    }
    if (req.taskId) {
      this.entryTaskIds.set(entry.id, req.taskId);
      taskGraphRepo.recordHandoffRequested({
        conversationId: chain.conversationId,
        taskId: req.taskId,
        fromAgentId: req.fromAgentId,
        toAgentId: req.toAgentId,
        passId: pass.id,
        requestedAction: req.content,
      });
    }
    this.startOfferTimer(chain, pass.id, req.fromAgentId, req.toAgentId);

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

  onAgentResponse(agentId: string, response: string, conversationId: string, taskId?: string): void {
    let chain = this.chainRepo.getActiveByConversation(conversationId);
    if (!chain) {
      // Chainless path: workflow-dispatched agent has no active chain.
      // Scan for actionable @mentions and create chain on demand.
      const mentionConfigs = this.config.getAgentMentionConfigs?.(conversationId) ?? this.agents;
      const targets = scanPassIntents(response, mentionConfigs, agentId);
      if (targets.length === 0) return;

      chain = this.createChain({
        conversationId,
        type: 'agent_handoff',
        messageId: `chainless-${agentId}-${Date.now()}`,
      });

      this.audit('chainless_handoff', {
        chainId: chain.id,
        conversationId,
        fromAgentId: agentId,
        reason: 'workflow-dispatched agent had actionable @mentions, created chain on demand',
      });

      // Virtual completed entry for the source agent (they already finished responding)
      const virtualHash = computeContentHash(agentId, 'chain-root', 'virtual-holder');
      const virtualEntry = this.chainRepo.appendWorklist(chain.id, agentId, 'system', '[virtual holder: chainless response]', virtualHash, 0);
      if (virtualEntry) {
        this.chainRepo.markExecuting(virtualEntry.id);
        this.chainRepo.markDone(virtualEntry.id, 'success');
      }

      // Give the source agent an open possession so they can hand off
      const { pass: holderPass } = this.possessionRepo.createPass({
        chainId: chain.id,
        fromHolderId: 'user',
        toAgentId: agentId,
        intent: 'delegate',
        packet: buildHandoffPacketDraft({
          fromHolderId: 'user',
          toAgentId: agentId,
          content: '[chainless handoff origin]',
          intent: 'delegate',
          sourceMessageIds: [],
        }),
      });
      this.possessionRepo.startPass(holderPass.id);
      // NOTE: don't completeHolder yet — createPass below needs an open possession for agentId

      // Process @mention targets — leave entries as 'queued', let dispatchNext handle state
      const startedPassIds: string[] = [];
      for (const target of targets) {
        const contentHash = computeContentHash(agentId, target.agentId, target.content);
        const entry = this.chainRepo.appendWorklist(chain.id, target.agentId, agentId, target.content, contentHash, 1);
        if (!entry) continue;
        if (taskId) this.entryTaskIds.set(entry.id, taskId);
        const { pass: targetPass } = this.possessionRepo.createPass({
          chainId: chain.id,
          fromHolderId: agentId,
          toAgentId: target.agentId,
          intent: target.intent,
          packet: buildHandoffPacketDraft({
            fromHolderId: agentId,
            toAgentId: target.agentId,
            content: target.content,
            intent: target.intent,
            sourceMessageIds: [],
          }),
        });
        this.entryPassIds.set(entry.id, targetPass.id);
        startedPassIds.push(targetPass.id);
        this.audit('dispatch_allowed', {
          chainId: chain.id,
          conversationId,
          fromAgentId: agentId,
          toAgentId: target.agentId,
          contentHash,
          metadata: { chainlessHandoff: true },
        });
      }

      // Complete the source agent's possession, then start target passes and dispatch
      this.possessionRepo.completeHolder(chain.id, agentId, response.slice(0, 1000));
      for (const passId of startedPassIds) {
        this.possessionRepo.startPass(passId);
        this.clearPassTimer(passId);
      }

      this.dispatchNext(chain.id, conversationId);
      return;
    }

    // Find the active entry for this agent. In possession mode an entry may
    // still be dispatching when the first response proves the process started.
    const executingEntry = this.chainRepo.getActiveEntry(chain.id, agentId);
    if (executingEntry) {
      this.markDispatchStarted(chain.id, executingEntry.id, conversationId, agentId);
    }

    const possessionChain = this.possessionRepo.getById(chain.id);
    const openPossession = this.possessionRepo.getOpenPossessionForHolder(chain.id, agentId);
    if (possessionChain && !openPossession) {
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

    const mentionConfigs = this.config.getAgentMentionConfigs?.(conversationId) ?? this.agents;

    // Don't scan short responses without @mentions (anti-ack), but allow short
    // explicit handoffs such as "@luigi 请验证".
    const hasToolUse = response.includes('tool_use');
    const hasMentionToken = scanMentions(response, mentionConfigs, agentId).length > 0
      || findUnresolvedMentionTokens(response, mentionConfigs, agentId).length > 0;
    if (!hasToolUse && !hasMentionToken && response.length < MIN_SUBSTANTIVE_LENGTH) {
      this.tryCompleteChain(chain.id);
      return;
    }

    // Scan against the conversation runtime roster when available.
    const targets = scanPassIntents(response, mentionConfigs, agentId);
    if (targets.length === 0) {
      const knownMentionTargets = scanMentions(response, mentionConfigs, agentId);
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
        this.io.to(conversationId).emit('agent:event', {
          type: 'system',
          content: `A2A 拦截：${reason}`,
          conversationId,
        });
      }
      if (knownMentionTargets.length > 0 && !hasExplicitNoHandoffLanguage(response)) {
        const tokens = Array.from(new Set(
          knownMentionTargets.map((target) => target.pattern ?? `@${target.agentId}`),
        ));
        const notificationStyle = hasNotificationStyleMention(response);
        const reason = notificationStyle
          ? formatNotificationMentionNotice(tokens)
          : formatNonActionableMentionNotice(tokens);
        this.audit('dispatch_blocked', {
          chainId: chain.id,
          conversationId,
          fromAgentId: agentId,
          reason: 'mention_without_pass_intent',
          metadata: {
            blockedBy: 'pass_intent',
            diagnostic: reason,
            mentions: tokens,
            notificationStyle,
          },
        });
        this.io.to(conversationId).emit('agent:event', {
          type: 'system',
          content: reason,
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
        taskId,
      });

      if (!decision.allow && !decision.silent) {
        const displayReason = formatDispatchBlockReason(decision.reason);
        this.io.to(conversationId).emit('agent:event', {
          type: 'system',
          content: decision.escalatedToAgentId
            ? `A2A 拦截：${displayReason} 已升级给 @${decision.escalatedToAgentId} 协调。`
            : `A2A 拦截：${displayReason}`,
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
    taskId?: string,
  ): InvocationChain {
    const chain = this.createChain({
      conversationId,
      type: 'user_message',
      messageId,
    });

    const startedPassIds: string[] = [];
    for (const targetAgentId of [...new Set(targetAgentIds)]) {
      const contentHash = computeContentHash('user', targetAgentId, prompt);
      const entry = this.chainRepo.appendWorklist(chain.id, targetAgentId, 'user', prompt, contentHash, 0);
      if (!entry) continue;
      if (taskId) this.entryTaskIds.set(entry.id, taskId);
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
      startedPassIds.push(pass.id);
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

    for (const passId of startedPassIds) {
      this.possessionRepo.startPass(passId);
      this.clearPassTimer(passId);
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
      const referencedTaskId = this.entryTaskIds.get(next.id);

      const passOfferPayload = {
        agentId: next.agentId,
        prompt,
        referencedTaskId,
        fromAgentId: next.requestedBy,
        conversationId,
        chainId,
        entryId: next.id,
        passId,
      };

      this.io.to(conversationId).emit('a2a:pass-offer', passOfferPayload);

      // Compatibility event for the current client. The client must ACK with
      // a2a:agent-started before this becomes executing in the possession model.
      const serverSubmission = this.config.submitDispatch?.({
        agentId: next.agentId,
        prompt,
        referencedTaskId,
        fromAgentId: next.requestedBy,
        conversationId,
        chainId,
        entryId: next.id,
        passId,
      });
      const dispatchPayload = {
        agentId: next.agentId,
        prompt,
        referencedTaskId,
        fromAgentId: next.requestedBy,
        conversationId,
        chainId,
        entryId: next.id,
        passId,
        handledByHarness: serverSubmission?.handled ?? false,
      };
      this.io.to(conversationId).emit('a2a:dispatch', dispatchPayload);
      this.recordDeliverySent({
        conversationId,
        chainId,
        entryId: next.id,
        passId,
        agentId: next.agentId,
        payload: dispatchPayload,
      });

      if (serverSubmission?.handled) {
        void serverSubmission.completion.then((outcome) => {
          if (outcome.status === 'accepted') {
            this.markDispatchStarted(chainId, next.id, conversationId, next.agentId, passId);
            return;
          }
          // A server-side profile/context may be unavailable while an older
          // browser still has a compatible snapshot. Re-emit explicitly as a
          // compatibility fallback instead of losing the A2A handoff.
          this.io.to(conversationId).emit('a2a:dispatch', {
            ...dispatchPayload,
            handledByHarness: false,
            harnessFallbackReasonCode: outcome.reasonCode ?? outcome.status,
          });
        });
      }

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
      this.clearPassTimer(resolvedPassId);
      const referencedTaskId = this.entryTaskIds.get(entryId);
      const pass = this.possessionRepo.getPass(resolvedPassId);
      if (referencedTaskId && pass) {
        taskGraphRepo.recordHandoffAccepted({
          conversationId,
          taskId: referencedTaskId,
          fromAgentId: pass.fromHolderId,
          toAgentId: agentId,
          passId: resolvedPassId,
        });
      }
      this.io.to(conversationId).emit('a2a:possession-changed', {
        chainId,
        conversationId,
        currentHolderId: agentId,
        passId: resolvedPassId,
      });
    }
  }

  private createPolicyEscalationDispatch(
    chain: InvocationChain,
    req: DispatchRequest,
    escalationTargetId: string,
    reason: string,
  ): WorklistEntry | null {
    if (!escalationTargetId || escalationTargetId === req.fromAgentId || escalationTargetId === req.toAgentId) {
      return null;
    }

    const content = [
      `原始 A2A 转交被协作规则阻止：@${req.fromAgentId} 无法直接交给 @${req.toAgentId}。`,
      `请协调 @${req.toAgentId} 接手，或调整任务路径。`,
      `阻断原因：${reason}`,
      '',
      `原始请求：${req.content}`,
    ].join('\n');
    const contentHash = computeContentHash(req.fromAgentId, escalationTargetId, content);
    const entry = this.chainRepo.appendWorklist(
      chain.id,
      escalationTargetId,
      req.fromAgentId,
      content,
      contentHash,
      req.depth,
    );

    if (!entry) return null;

    const { pass } = this.possessionRepo.createPass({
      chainId: chain.id,
      fromHolderId: req.fromAgentId,
      toAgentId: escalationTargetId,
      intent: 'escalate',
      packet: buildHandoffPacketDraft({
        fromHolderId: req.fromAgentId,
        toAgentId: escalationTargetId,
        content,
        intent: 'escalate',
      }),
    });
    this.entryPassIds.set(entry.id, pass.id);
    if (req.taskId) this.entryTaskIds.set(entry.id, req.taskId);
    this.startOfferTimer(chain, pass.id, req.fromAgentId, escalationTargetId);

    this.audit('dispatch_allowed', {
      chainId: chain.id,
      conversationId: chain.conversationId,
      fromAgentId: req.fromAgentId,
      toAgentId: escalationTargetId,
      contentHash,
      metadata: {
        passId: pass.id,
        policyEscalation: true,
        blockedToAgentId: req.toAgentId,
      },
    });

    return entry;
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

  markDispatchDeferred(
    chainId: string,
    entryId: string,
    conversationId: string,
    agentId: string,
    reason: string,
    passId?: string,
  ): void {
    const chain = this.chainRepo.getById(chainId);
    if (!chain || chain.status !== 'active') return;
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chain_worklist
      SET status = 'queued', started_at = NULL
      WHERE id = ? AND chain_id = ? AND agent_id = ?
    `).run(entryId, chainId, agentId);
    this.db.prepare(`
      INSERT INTO a2a_delivery
        (id, conversation_id, chain_id, entry_id, pass_id, agent_id, event_type, payload, status, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'a2a:dispatch', '{}', 'pending', 0, ?, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        status = 'pending',
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(
      `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId,
      chainId,
      entryId,
      passId ?? this.entryPassIds.get(entryId) ?? null,
      agentId,
      reason,
      now,
      now,
    );
    this.setAgentState(agentId, 'idle');
    this.audit('dispatch_blocked', {
      chainId,
      conversationId,
      toAgentId: agentId,
      reason,
      metadata: { dispatchDeferred: true },
    });
  }

  resendPendingDeliveries(conversationId: string): void {
    const chain = this.chainRepo.getActiveByConversation(conversationId);
    if (!chain) return;
    this.dispatchNext(chain.id, conversationId);
  }

  private recordDeliverySent(input: {
    conversationId: string;
    chainId: string;
    entryId: string;
    passId?: string;
    agentId: string;
    payload: unknown;
  }): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO a2a_delivery
        (id, conversation_id, chain_id, entry_id, pass_id, agent_id, event_type, payload, status, attempts, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'a2a:dispatch', ?, 'sent', 1, NULL, ?, ?)
      ON CONFLICT(entry_id) DO UPDATE SET
        pass_id = excluded.pass_id,
        payload = excluded.payload,
        status = 'sent',
        attempts = attempts + 1,
        last_error = NULL,
        updated_at = excluded.updated_at
    `).run(
      `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      input.conversationId,
      input.chainId,
      input.entryId,
      input.passId ?? null,
      input.agentId,
      JSON.stringify(input.payload),
      now,
      now,
    );
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

  private startOfferTimer(
    chain: InvocationChain,
    passId: string,
    fromAgentId: string,
    toAgentId: string,
  ): void {
    const timeoutMs = chain.config.offerTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return;

    this.clearPassTimer(passId);
    const timer = setTimeout(() => {
      this.passTimers.delete(passId);
      const currentChain = this.chainRepo.getById(chain.id);
      const pass = this.possessionRepo.getPass(passId);
      if (!currentChain || currentChain.status !== 'active' || !pass || pass.status !== 'offered') return;

      const reason = 'A2A 转交未被执行端确认';
      this.chainRepo.abort(chain.id, 'timeout');
      this.possessionRepo.timeoutChain(chain.id, 'offer', reason);
      this.clearChainTimer(chain.id);
      clearRippleForChain(chain.id);
      this.audit('chain_timeout', {
        chainId: chain.id,
        conversationId: chain.conversationId,
        fromAgentId,
        toAgentId,
        reason,
        metadata: { phase: 'offer', passId },
      });
      this.io.to(chain.conversationId).emit('agent:event', {
        type: 'system',
        content: `A2A offer 阶段超时：${reason}`,
        conversationId: chain.conversationId,
      });
      this.emitPassBlocked(chain.conversationId, chain.id, fromAgentId, toAgentId, reason, 'timeout');
    }, timeoutMs);
    timer.unref?.();

    this.passTimers.set(passId, timer);
  }

  private clearPassTimer(passId: string): void {
    const timer = this.passTimers.get(passId);
    if (timer) {
      clearTimeout(timer);
      this.passTimers.delete(passId);
    }
  }

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
        this.io.to(chain.conversationId).emit('agent:event', {
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
    this.io.to(conversationId).emit('a2a:pass-blocked', {
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

  private rebuildStateFromDB(): void {
    const activeChains = this.db.prepare(`
      SELECT * FROM invocation_chain WHERE status = 'active'
    `).all() as any[];

    for (const row of activeChains) {
      const chain = this.chainRepo.getById(row.id);
      if (chain) this.startChainTimer(chain);
    }

    const activeEntries = this.db.prepare(`
      SELECT
        w.id AS entry_id,
        w.chain_id,
        w.agent_id,
        w.status,
        (
          SELECT p.id FROM a2a_pass p
          WHERE p.chain_id = w.chain_id
            AND p.to_agent_id = w.agent_id
            AND p.status IN ('offered', 'accepted', 'starting', 'started')
          ORDER BY p.updated_at DESC
          LIMIT 1
        ) AS pass_id
      FROM chain_worklist w
      JOIN invocation_chain c ON c.id = w.chain_id
      WHERE c.status = 'active'
        AND w.status IN ('queued', 'dispatching', 'executing')
    `).all() as Array<{
      entry_id: string;
      chain_id: string;
      agent_id: string;
      status: 'queued' | 'dispatching' | 'executing';
      pass_id?: string | null;
    }>;

    for (const entry of activeEntries) {
      this.setAgentState(
        entry.agent_id,
        entry.status === 'executing' ? 'executing' : 'queued',
        entry.chain_id,
      );
      if (entry.pass_id) this.entryPassIds.set(entry.entry_id, entry.pass_id);
    }

    const offeredPasses = this.db.prepare(`
      SELECT p.id, p.chain_id, p.from_holder_id, p.to_agent_id
      FROM a2a_pass p
      JOIN invocation_chain c ON c.id = p.chain_id
      WHERE c.status = 'active' AND p.status = 'offered'
    `).all() as Array<{ id: string; chain_id: string; from_holder_id: string; to_agent_id: string }>;

    for (const pass of offeredPasses) {
      const chain = this.chainRepo.getById(pass.chain_id);
      if (chain) this.startOfferTimer(chain, pass.id, pass.from_holder_id, pass.to_agent_id);
    }
  }

  // ──────────────────────────────────────────────
  // Reset (for testing)
  // ──────────────────────────────────────────────

  reset(): void {
    this.agentStates.clear();
    this.entryPassIds.clear();
    this.entryTaskIds.clear();
    for (const timer of this.chainTimers.values()) clearTimeout(timer);
    this.chainTimers.clear();
    for (const timer of this.passTimers.values()) clearTimeout(timer);
    this.passTimers.clear();
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
