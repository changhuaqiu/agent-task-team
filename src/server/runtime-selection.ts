import {
  isRuntimeCliEngine,
  normalizeRuntimeCliEngine,
  type RuntimeCliEngine,
} from '@/lib/team-runtime/runtimeEngine';

export const RUNTIME_ID_BY_ENGINE: Record<RuntimeCliEngine, string> = {
  opencode: 'opencode-local',
  claude: 'claude-cli',
  codex: 'codex-cli',
};

const ENGINE_BY_RUNTIME_ID = Object.fromEntries(
  Object.entries(RUNTIME_ID_BY_ENGINE).map(([engine, runtimeId]) => [runtimeId, engine]),
) as Record<string, RuntimeCliEngine>;

export type RuntimeSelection = { engine: RuntimeCliEngine; runtimeId: string };

export function resolveRuntimeSelection(engine: unknown, runtimeId: unknown): RuntimeSelection {
  const requestedEngine = engine === undefined ? undefined : engine;
  if (runtimeId !== undefined && (typeof runtimeId !== 'string' || !runtimeId.trim())) {
    throw new Error(`unsupported Agent runtime: ${String(runtimeId)}`);
  }
  const requestedRuntimeId = runtimeId === undefined ? undefined : runtimeId.trim();

  if (requestedEngine !== undefined && !isRuntimeCliEngine(requestedEngine)) {
    throw new Error(`unsupported Agent engine: ${String(requestedEngine)}`);
  }
  const runtimeEngine = requestedRuntimeId ? ENGINE_BY_RUNTIME_ID[requestedRuntimeId] : undefined;
  if (requestedRuntimeId && !runtimeEngine) {
    throw new Error(`unsupported Agent runtime: ${requestedRuntimeId}`);
  }
  if (requestedEngine && runtimeEngine && requestedEngine !== runtimeEngine) {
    throw new Error(`Agent engine/runtime mismatch: ${requestedEngine}/${requestedRuntimeId}`);
  }

  const selectedEngine = runtimeEngine ?? requestedEngine ?? 'opencode';
  return {
    engine: selectedEngine,
    runtimeId: requestedRuntimeId ?? RUNTIME_ID_BY_ENGINE[selectedEngine],
  };
}

export function normalizePersistedRuntimeSelection(
  engine: unknown,
  runtimeId: unknown,
): { engine: RuntimeCliEngine; runtimeId?: string } {
  const normalizedEngine = normalizeRuntimeCliEngine(engine);
  if (!normalizedEngine) throw new Error(`unsupported persisted Agent engine: ${String(engine)}`);
  const normalizedRuntimeId = runtimeId === 'gemini-cli'
    ? RUNTIME_ID_BY_ENGINE.opencode
    : typeof runtimeId === 'string' && runtimeId.trim()
      ? runtimeId.trim()
      : undefined;
  if (
    normalizedRuntimeId
    && normalizedRuntimeId !== RUNTIME_ID_BY_ENGINE[normalizedEngine]
  ) {
    throw new Error(`persisted Agent engine/runtime mismatch: ${String(engine)}/${normalizedRuntimeId}`);
  }
  return { engine: normalizedEngine, runtimeId: normalizedRuntimeId };
}
