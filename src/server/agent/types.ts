// src/server/agent/types.ts

// --- Unified event types ---
export type AgentEventType =
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  content: string;
  tool?: {
    name: string;
    callId?: string;
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
  durationMs: number;
  sessionId?: string;
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

export interface BackendConfig {
  executablePath: string;
  env?: Record<string, string>;
}

export interface AgentBackend {
  execute(prompt: string, opts: ExecOptions): AgentRun;
}
