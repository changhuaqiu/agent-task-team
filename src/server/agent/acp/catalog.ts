// src/server/agent/acp/catalog.ts
//
// AgentCatalog — the declarative startup source of truth for ACP runtimes.
// Spec: specs/acp-runtime-integration/spec.md §5.1.
//
// The catalog records how to launch each ACP agent (native or adapter), its
// locked version, and the capabilities verified by a real-runtime smoke. The
// daemon factory will route by catalog entry instead of a per-engine `switch`
// once migration completes (Task 8).
//
// `createBackend` is the single bridge from a catalog entry to a live
// `AgentBackend`. Per the Task 4 override, AcpBackend auto-approves permissions
// inline — there is NO `permission` parameter here (the brief's 3-arg signature
// was corrected to `createBackend(entry, cwd?)`).

import { AcpBackend } from './acpBackend';
import type { AgentBackend } from '../types';
import type { EngineId } from '../capabilities';
import seed from './agentCatalog.seed.json';

/**
 * A single ACP runtime entry in the Agent Catalog (spec §5.1).
 *
 * The spec §5.1 fields (`id`, `protocol`, `delivery`, `launcher`,
 * `legacyBackend`, `verifiedCapabilities`) are authoritative. The seed also
 * carries descriptive fields (`protocolVersion`, `agentInfo`, `probeNote`); the
 * `[key: string]: unknown` index lets them coexist without forcing every
 * consumer to model them.
 */
export interface AgentCatalogEntry {
  id: string;
  protocol: 'acp';
  delivery: 'native' | 'adapter';
  launcher: {
    command: string;
    args: string[];
    package?: string;
    version?: string;
  };
  legacyBackend?: 'opencode' | 'claude' | 'codex';
  verifiedCapabilities: string[];
  // Seed carries extra descriptive fields (protocolVersion, agentInfo,
  // probeNote). Allow them without making every consumer model them:
  [key: string]: unknown;
}

/**
 * Load the catalog from the seed JSON. The seed is the startup source of truth
 * (spec §5.1: "Catalog 是启动事实源"). Cast through `unknown` because JSON
 * module inference types string values as `string`, not the literals (`"acp"`,
 * `"native"`) required by the contract — the seed is hand-curated to conform.
 */
export function loadCatalog(): AgentCatalogEntry[] {
  return seed as unknown as AgentCatalogEntry[];
}

/**
 * Create a live `AgentBackend` for a catalog entry.
 *
 * The entry's `id` is also a valid `EngineId` (the three runtimes are
 * 'opencode' | 'claude' | 'codex'), so it flows straight through as the
 * `engine` identity on the resulting `CapabilitySet`.
 *
 * @param entry  Catalog entry to launch.
 * @param opts   Optional `{ cwd, env }`:
 *                 - `cwd`: working directory for the agent process + ACP session.
 *                 - `env`: extra env vars merged on top of `process.env` when
 *                   spawning the agent subprocess. Used by the codex smoke +
 *                   daemon (Task 8) to isolate `CODEX_HOME` — codex-acp reads
 *                   `CODEX_HOME` to locate its `auth.json` + `config.toml`.
 */
export function createBackend(
  entry: AgentCatalogEntry,
  opts?: { cwd?: string; env?: Record<string, string> },
): AgentBackend {
  return new AcpBackend({
    command: entry.launcher.command,
    args: entry.launcher.args,
    cwd: opts?.cwd,
    env: opts?.env,
    engine: entry.id as EngineId,
  });
}
