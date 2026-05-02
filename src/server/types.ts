// src/server/types.ts

export type CliEngine = 'opencode' | 'claude' | 'codex' | 'gemini' | 'mock';

export interface DetectedRuntime {
  engine: CliEngine;
  available: boolean;
  path?: string;
  version?: string;
}
