// src/server/agent/types.ts

// --- Unified event types ---
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';

export type EngineId = RuntimeCliEngine;

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
    input?: string;
    output?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'failed';
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
  systemPrompt?: string;
  timeout?: number;
  resumeSessionId?: string;
  env?: Record<string, string>;
}

export interface AgentRun {
  /** Resolves only after ACP initialization and session setup, before prompt execution. */
  started: Promise<
    | { ok: true; sessionId?: string }
    | { ok: false; reasonCode: string; message: string }
  >;
  /** Backend-normalized stream containing exactly one terminal `done` event. */
  events: AsyncGenerator<AgentEvent>;
  result: Promise<AgentResult>;
  kill: () => void;
}

// NOTE: `BackendConfig` (the bespoke backends' constructor shape) was removed
// in Task 10 — AcpBackend has its own config type. See
// specs/acp-runtime-integration/spec.md §7.4/§8.

export interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
}
