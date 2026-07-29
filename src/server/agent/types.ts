// src/server/agent/types.ts

import type { CapabilitySet } from './capabilities';

// --- Unified event types ---
export type AgentEventType =
  | 'text'
  | 'thinking'
  | 'plan'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  content: string;
  tool?: {
    name: string;
    displayName?: string;
    callId?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'failed';
    input?: string;
    output?: string;
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  sessionId?: string;
}

export interface AgentResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  output: string;
  error?: string;
  reasonCode?: string;
  durationMs: number;
  sessionId?: string;
  usage?: Record<string, { inputTokens: number; outputTokens: number }>;
}

// --- Backend interface ---
export interface ExecOptions {
  cwd?: string;
  model?: string;
  systemPrompt?: string;
  maxTurns?: number;
  timeout?: number;
  resumeSessionId?: string;
  customArgs?: string[];
  env?: Record<string, string>;
}

export interface AgentRun {
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
  kill: () => void;
}

// NOTE: `BackendConfig` (the bespoke backends' constructor shape) was removed
// in Task 10 — AcpBackend has its own config type. See
// specs/acp-runtime-integration/spec.md §7.4/§8.

export interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
  /** 该 backend 的能力声明，供 CapabilityRouter（Phase 2）按能力调度 + 降级 */
  readonly capabilities: CapabilitySet;
}
