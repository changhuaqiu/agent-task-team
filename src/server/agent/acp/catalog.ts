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
// `AgentBackend`. Permission decisions are injected explicitly; when omitted,
// AcpBackend uses its fail-closed default policy.

import { AcpBackend, type AcpBackendOpts } from './acpBackend';
import type { AgentBackend } from '../types';
import type { EngineId } from '../capabilities';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import seed from './agentCatalog.seed.json';

/**
 * A single ACP runtime entry in the Agent Catalog (spec §5.1).
 *
 * The spec §5.1 fields (`id`, `protocol`, `delivery`, `launcher`,
 * `verifiedCapabilities`) are authoritative. The seed also
 * carries descriptive fields (`protocolVersion`, `agentInfo`, `probeNote`); the
 * `[key: string]: unknown` index lets them coexist without forcing every
 * consumer to model them.
 */
export interface AgentCatalogEntry {
  id: EngineId;
  protocol: 'acp';
  delivery: 'native' | 'adapter';
  launcher: {
    command: string;
    args: string[];
    package?: string;
    version?: string;
  };
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
  return validateCatalog(seed);
}

export function validateCatalog(value: unknown): AgentCatalogEntry[] {
  if (!Array.isArray(value)) throw new Error('ACP catalog must be an array');
  const ids = new Set<string>();
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`ACP catalog entry ${index} must be an object`);
    }
    const entry = candidate as Record<string, unknown>;
    const launcher = entry.launcher as Record<string, unknown> | undefined;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    if (!id || ids.has(id)) throw new Error(`ACP catalog has invalid or duplicate id: ${id || index}`);
    if (id !== 'opencode' && id !== 'claude' && id !== 'codex') {
      throw new Error(`ACP catalog has unsupported runtime id: ${id}`);
    }
    ids.add(id);
    if (entry.protocol !== 'acp') throw new Error(`ACP catalog ${id} has unsupported protocol`);
    if (entry.delivery !== 'native' && entry.delivery !== 'adapter') {
      throw new Error(`ACP catalog ${id} has invalid delivery`);
    }
    if (!launcher || typeof launcher.command !== 'string' || !launcher.command.trim()) {
      throw new Error(`ACP catalog ${id} has no launcher command`);
    }
    if (!Array.isArray(launcher.args) || !launcher.args.every((arg) => typeof arg === 'string')) {
      throw new Error(`ACP catalog ${id} has invalid launcher args`);
    }
    if (!Array.isArray(entry.verifiedCapabilities)) {
      throw new Error(`ACP catalog ${id} has invalid verifiedCapabilities`);
    }
    if (entry.delivery === 'adapter') {
      const packageName = typeof launcher.package === 'string' ? launcher.package : '';
      const version = typeof launcher.version === 'string' ? launcher.version : '';
      if (!packageName || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
        throw new Error(`ACP catalog ${id} adapter must declare an exact version`);
      }
      if (!(launcher.args as string[]).includes(`${packageName}@${version}`)) {
        throw new Error(`ACP catalog ${id} launcher is not pinned to ${packageName}@${version}`);
      }
    }
    return candidate as AgentCatalogEntry;
  });
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
  opts?: Pick<
    AcpBackendOpts,
    | 'cwd'
    | 'env'
    | 'permissionPolicy'
    | 'permissionTimeoutMs'
    | 'cancelGraceMs'
    | 'forceKillGraceMs'
    | 'maxTurnTimeoutMs'
    | 'limits'
    | 'timeoutMs'
    | 'mcpServers'
    | 'autoApproveMcpToolNames'
    | 'forwardNativeSubagentText'
  >,
): AgentBackend {
  const launcher = resolveCatalogLauncher(entry);
  return new AcpBackend({
    command: launcher.command,
    args: launcher.args,
    cwd: opts?.cwd,
    env: opts?.env,
    permissionPolicy: opts?.permissionPolicy,
    permissionTimeoutMs: opts?.permissionTimeoutMs,
    cancelGraceMs: opts?.cancelGraceMs,
    forceKillGraceMs: opts?.forceKillGraceMs,
    maxTurnTimeoutMs: opts?.maxTurnTimeoutMs,
    limits: opts?.limits,
    timeoutMs: opts?.timeoutMs,
    mcpServers: opts?.mcpServers,
    autoApproveMcpToolNames: opts?.autoApproveMcpToolNames,
    forwardNativeSubagentText:
      opts?.forwardNativeSubagentText ?? (entry.id === 'claude'),
    engine: entry.id,
  });
}

const INSTALLED_ADAPTER_BINARIES: Readonly<Record<string, string>> = {
  '@agentclientprotocol/claude-agent-acp': 'claude-agent-acp',
  '@agentclientprotocol/codex-acp': 'codex-acp',
};

export function resolveCatalogLauncher(
  entry: AgentCatalogEntry,
  appRoot = process.cwd(),
): { command: string; args: string[] } {
  const packageName = entry.launcher.package;
  const binaryName = packageName ? INSTALLED_ADAPTER_BINARIES[packageName] : undefined;
  if (entry.delivery === 'adapter' && binaryName) {
    const executable = join(
      appRoot,
      'node_modules',
      '.bin',
      `${binaryName}${process.platform === 'win32' ? '.cmd' : ''}`,
    );
    if (existsSync(executable)) return { command: executable, args: [] };
  }
  return { command: entry.launcher.command, args: [...entry.launcher.args] };
}
