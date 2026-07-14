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

// The per-engine capability CONSTANTS (CLAUDE_CAPS / OPENCODE_CAPS / CODEX_CAPS)
// were removed in Task 10 along with the bespoke backends — AcpBackend now
// derives its CapabilitySet from the catalog entry's EngineId, and
// capabilityRouter consumers pass a synthetic CapabilitySet. See
// specs/acp-runtime-integration/spec.md §7.4/§8.
