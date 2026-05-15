// src/server/a2a/types-v2.ts
// A2A v2: Chain-Orchestrated Dispatch

// ────────────────────────��─────────────────────
// InvocationChain
// ──────────────────────────────────────────────

export interface ChainConfig {
  maxDepth: number;
  maxBreadth: number;
  maxDurationMs: number;
  allowedAgents?: string[];
}

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
  maxDepth: 5,
  maxBreadth: 4,
  maxDurationMs: 120_000,
};

export type ChainStatus = 'active' | 'completed' | 'aborted' | 'timeout';

export interface InvocationChain {
  id: string;
  conversationId: string;
  rootTriggerType: 'user_message' | 'scheduled';
  rootTriggerId: string;
  status: ChainStatus;
  config: ChainConfig;
  createdAt: string;
  completedAt?: string;
}

// ──────────────────────────────────────────────
// Worklist
// ──────────────────────────────────────────────

export type WorklistStatus = 'queued' | 'dispatching' | 'executing' | 'done' | 'aborted';
export type WorklistOutcome = 'success' | 'error' | 'timeout';

export interface WorklistEntry {
  id: string;
  chainId: string;
  agentId: string;
  requestedBy: string;
  prompt: string;
  contentHash: string;
  depth: number;
  status: WorklistStatus;
  outcome?: WorklistOutcome;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
}

// ──────────────────────────────────────────────
// DeliveryCursor
// ──────────────────────────────────────────────

export interface DeliveryCursor {
  agentId: string;
  conversationId: string;
  lastChainId?: string;
  lastEntryId?: string;
  updatedAt: string;
}

// ──────────────────────────────────────────────
// Orchestrator interfaces
// ──────────────────────────────────────────────

export type AgentRunState = 'idle' | 'executing' | 'queued';

export interface AgentState {
  status: AgentRunState;
  currentChainId?: string;
  lastCompletedAt?: string;
}

export interface DispatchRequest {
  chainId: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  depth: number;
  intent?: 'delegate' | 'review' | 'answer' | 'verify' | 'implement' | 'plan';
}

export type DispatchDecision =
  | { allow: true; entry: WorklistEntry }
  | { allow: false; reason: string; silent: boolean };

export interface ChainTrigger {
  conversationId: string;
  type: 'user_message' | 'scheduled';
  messageId: string;
  config?: Partial<ChainConfig>;
}

// ──────────────────────────────────────────────
// Context injection
// ──────────────────────────────────────────────

export interface TaskSummary {
  id: string;
  title: string;
  status: string;
  agentId: string;
}

export interface MessageSummary {
  id: string;
  from: string;
  content: string;
  timestamp: string;
}

export interface AgentDispatchContext {
  instruction: string;
  requestedBy: string;
  chainId: string;
  depth: number;
  remainingBudget: number;
  relevantTasks: TaskSummary[];
  otherAgentTasks: TaskSummary[];
  newMessages: MessageSummary[];
  responseGuidance: string;
}

// ──────────────────────────────────────────────
// Audit log
// ──────────────────────────────────────────────

export type AuditEventType =
  | 'dispatch_requested'
  | 'dispatch_allowed'
  | 'dispatch_blocked'
  | 'chain_created'
  | 'chain_completed'
  | 'chain_aborted'
  | 'chain_timeout'
  | 'cursor_advanced';

export interface AuditLogEntry {
  id: string;
  chainId?: string;
  conversationId: string;
  eventType: AuditEventType;
  fromAgentId?: string;
  toAgentId?: string;
  contentHash?: string;
  reason?: string;
  metadata?: string;
  createdAt: string;
}

// ──────────────────────────────────────────────
// Scanner (kept from v1, minimal change)
// ──────────────────────────────────────────────

export interface MentionTarget {
  agentId: string;
  position: number;
  pattern?: string;
}

export interface AgentMentionConfig {
  id: string;
  mentionPatterns: string[];
}
