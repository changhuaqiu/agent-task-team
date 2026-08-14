// src/server/types.ts

export type CliEngine = 'opencode' | 'claude' | 'codex' | 'gemini';

export interface DetectedRuntime {
  engine: CliEngine;
  available: boolean;
  path?: string;
  version?: string;
}
