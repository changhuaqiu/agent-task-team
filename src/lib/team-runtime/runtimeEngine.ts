export type RuntimeCliEngine = 'opencode' | 'claude' | 'codex';

export function isRuntimeCliEngine(engine: unknown): engine is RuntimeCliEngine {
  return engine === 'opencode' || engine === 'claude' || engine === 'codex';
}

export function normalizeRuntimeCliEngine(engine: unknown): RuntimeCliEngine | undefined {
  if (engine === 'gemini') return 'opencode';
  if (isRuntimeCliEngine(engine)) return engine;
  return undefined;
}
