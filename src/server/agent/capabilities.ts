// src/server/agent/capabilities.ts
// CLI 能力声明（CapabilitySet）—— 每个 backend 声明自己支持什么，
// 供 CapabilityRouter（Phase 2）按能力调度 + 降级。
// 详见 specs/cli-bridge-layer/spec.md 5.2 能力矩阵。

export type EngineId = 'claude' | 'opencode' | 'codex';

export interface CapabilitySet {
  engine: EngineId;
  /** prompt 如何传递给 CLI */
  promptMode: 'stdin-stream-json' | 'arg';
  /** CLI 输出格式（决定 backend 如何解析事件流）*/
  outputMode: 'stream-json' | 'ndjson' | 'events';
  supportsResume: boolean;
  supportsModel: boolean;
  supportsSystemPrompt: boolean;
  systemPromptMode: 'flag' | 'file' | 'none';
  supportsMaxTurns: boolean;
  supportsPermissionMode: boolean;
  /** 该 CLI 是否需要 PTY（如 opencode 的 Go binary 在非 TTY 下抑制 stdout）*/
  requiresPty: boolean;
}

export const CLAUDE_CAPS: CapabilitySet = {
  engine: 'claude',
  promptMode: 'stdin-stream-json',
  outputMode: 'stream-json',
  supportsResume: true,
  supportsModel: true,
  supportsSystemPrompt: true,
  systemPromptMode: 'flag',
  supportsMaxTurns: true,
  supportsPermissionMode: true,
  requiresPty: false,
};

export const OPENCODE_CAPS: CapabilitySet = {
  engine: 'opencode',
  promptMode: 'arg',
  outputMode: 'events',
  // Phase 3 实测（opencode run --help）：
  supportsResume: true,         // --continue / --session
  supportsModel: true,          // -m / --model
  supportsSystemPrompt: true,
  systemPromptMode: 'file',
  supportsMaxTurns: false,      // 无 --max-turns flag
  supportsPermissionMode: true, // --dangerously-skip-permissions
  requiresPty: true,
};

export const CODEX_CAPS: CapabilitySet = {
  engine: 'codex',
  promptMode: 'arg',
  outputMode: 'ndjson',
  supportsResume: false,
  supportsModel: true,
  supportsSystemPrompt: false,
  systemPromptMode: 'none',
  supportsMaxTurns: false,
  // codex 用固定的 --full-auto，视为一种（不可配置的）permission mode
  supportsPermissionMode: true,
  requiresPty: false,
};
