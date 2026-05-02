import type { AgentBackend, BackendConfig } from './types';
import { OpenCodeBackend } from './opencode';
import { ClaudeBackend } from './claude';
import { CodexBackend } from './codex';

export function createBackend(engine: string, config: BackendConfig): AgentBackend {
  switch (engine) {
    case 'opencode': return new OpenCodeBackend(config);
    case 'claude':   return new ClaudeBackend(config);
    case 'codex':    return new CodexBackend(config);
    case 'gemini':   return new OpenCodeBackend(config);
    case 'mock':     return new OpenCodeBackend(config);
    default: throw new Error(`Unknown engine: ${engine}`);
  }
}
