export const RUNTIME_CLI_ENGINES = [
  'goose', 'claude', 'codex', 'buzz-agent',
  'devin', 'cursor', 'omp', 'grok', 'opencode', 'kimi', 'amp', 'hermes', 'openclaw',
] as const;

export type BuiltinRuntimeCliEngine = typeof RUNTIME_CLI_ENGINES[number];
export type CustomRuntimeCliEngine = `custom:${string}`;
export type RuntimeCliEngine = BuiltinRuntimeCliEngine | CustomRuntimeCliEngine;

const CUSTOM_RUNTIME_PATTERN = /^custom:[a-z0-9][a-z0-9-]{1,47}$/;

export function isRuntimeCliEngine(engine: unknown): engine is RuntimeCliEngine {
  return typeof engine === 'string' && (
    (RUNTIME_CLI_ENGINES as readonly string[]).includes(engine)
    || CUSTOM_RUNTIME_PATTERN.test(engine)
  );
}

export function normalizeRuntimeCliEngine(engine: unknown): RuntimeCliEngine | undefined {
  if (engine === 'gemini') return 'opencode';
  if (isRuntimeCliEngine(engine)) return engine;
  return undefined;
}
