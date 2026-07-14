// src/server/agent/acp/runtimeSetup.ts
//
// Shared per-runtime ACP setup + the ACP/legacy routing selector.
//
// Spec: specs/acp-runtime-integration/spec.md §7.3–§7.4 (daemon routing).
//
// Two exports:
//
// 1. `chooseBackend(engine, catalog, useAcp)` — a PURE routing decision used by
//    the daemon (Task 8) to pick ACP vs legacy. Unit-testable without spawning
//    anything. ACP is chosen only when the migration flag is on AND the catalog
//    has a `prompt`-verified entry for the engine.
//
// 2. `prepareAcpRuntime(entry, opts)` — per-runtime filesystem/env setup the
//    ACP path needs (extracted from scripts/smoke-acp-runtime.ts so the daemon
//    and smoke share one implementation):
//      - opencode: writes a project-local `opencode.json` with a text-producing
//        model (host default glm-4.7 is thought-only). Skipped when the caller
//        already set `OPENCODE_CONFIG` (the daemon's account-config path wins).
//      - codex:    isolates `CODEX_HOME` into a temp dir with the ESSENTIAL
//        config (auth.json + config.toml), returns a cleanup fn that removes it.
//      - claude:   passthrough (auth comes from the host).
//
// This module has NO runtime spawn side effects — only filesystem/env prep.

import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentCatalogEntry } from './catalog';

// ---------------------------------------------------------------------------
// Routing selector (pure)
// ---------------------------------------------------------------------------

export type BackendChoice =
  | { kind: 'acp'; entry: AgentCatalogEntry }
  | { kind: 'legacy' };

/**
 * Decide whether to route `engine` to ACP or the legacy factory.
 *
 * ACP is chosen only when:
 *  - `useAcp` is true (the migration flag is on), AND
 *  - the catalog has an entry whose `id` matches `engine`, AND
 *  - that entry has `prompt` in its `verifiedCapabilities` (the runtime accepts
 *    a prompt turn and produces output — the minimum bar for routing real work
 *    through ACP).
 *
 * Otherwise the caller falls back to the legacy per-engine factory.
 */
export function chooseBackend(
  engine: string,
  catalog: AgentCatalogEntry[],
  useAcp: boolean,
): BackendChoice {
  if (!useAcp) return { kind: 'legacy' };
  const entry = catalog.find((e) => e.id === engine);
  if (!entry) return { kind: 'legacy' };
  if (!entry.verifiedCapabilities.includes('prompt')) {
    return { kind: 'legacy' };
  }
  return { kind: 'acp', entry };
}

// ---------------------------------------------------------------------------
// Per-runtime setup
// ---------------------------------------------------------------------------

export interface PreparedRuntime {
  /** Working directory the ACP agent should run in. */
  cwd: string;
  /** Env vars (merged on top of process.env at spawn time). */
  env: Record<string, string>;
  /** Optional cleanup (e.g. remove the temp CODEX_HOME). Call on completion/error. */
  cleanup?: () => void;
}

export interface PrepareAcpOptions {
  cwd: string;
  env: Record<string, string>;
  /**
   * opencode model to write into the project-local `opencode.json` fallback.
   * Defaults to `deepseek/deepseek-chat` — the host's configured default
   * (`zhipuai-coding-plan/glm-4.7`) emits only `agent_thought_chunk` with
   * ~1 output token and produces NO `agent_message_chunk` (text), so a
   * text-producing model is required. Ignored when `env.OPENCODE_CONFIG` is
   * already set (the daemon's account-config path takes precedence).
   */
  opencodeModel?: string;
}

const DEFAULT_OPENCODE_MODEL = 'deepseek/deepseek-chat';

/**
 * The host opencode default model that ONLY emits thought chunks (no text).
 * Documented to explain why the fallback model is required.
 */
export const HOST_THOUGHT_ONLY_OPENCODE_MODEL = 'zhipuai-coding-plan/glm-4.7';

/**
 * Prepare the filesystem/env for an ACP runtime turn.
 *
 * Dispatches on `entry.legacyBackend ?? entry.id` so both native (opencode,
 * which has no `legacyBackend`) and adapter (claude/codex) entries map to the
 * right setup branch.
 *
 * Side effects:
 *  - opencode: may write `{cwd}/opencode.json`.
 *  - codex:    creates a temp dir + copies `~/.codex/{auth.json,config.toml}`.
 *
 * Always returns a `PreparedRuntime`; `cleanup` is present only for codex.
 */
export function prepareAcpRuntime(
  entry: AgentCatalogEntry,
  opts: PrepareAcpOptions,
): PreparedRuntime {
  const runtime = entry.legacyBackend ?? entry.id;

  switch (runtime) {
    case 'opencode': {
      // If the caller (daemon) already generated an account/provider config
      // via OPENCODE_CONFIG, that config owns the model — don't write a
      // competing cwd file that could override it. Otherwise write a
      // fallback so the agent uses a text-producing model instead of the
      // host's thought-only default.
      if (!opts.env.OPENCODE_CONFIG) {
        const model = opts.opencodeModel ?? DEFAULT_OPENCODE_MODEL;
        writeFileSync(
          join(opts.cwd, 'opencode.json'),
          `${JSON.stringify({ model }, null, 2)}\n`,
        );
      }
      return { cwd: opts.cwd, env: opts.env };
    }

    case 'codex': {
      // Isolate CODEX_HOME: copy ONLY the essential config (auth.json +
      // config.toml) into a temp dir. codex-acp reads CODEX_HOME to locate its
      // config. Skip cache/sqlite/goals_*/logs — keep the isolated home minimal.
      // The temp dir is cleaned up via the returned `cleanup` fn (Task 7 Minor).
      const codexHomeSrc = join(homedir(), '.codex');
      const codexHomeTmp = mkdtempSync(join(tmpdir(), 'acp-codex-home-'));

      const authSrc = join(codexHomeSrc, 'auth.json');
      const configSrc = join(codexHomeSrc, 'config.toml');
      if (existsSync(authSrc)) {
        copyFileSync(authSrc, join(codexHomeTmp, 'auth.json'));
      } else {
        console.warn(
          `[acp] WARNING: ${authSrc} not found — codex auth may fail`,
        );
      }
      if (existsSync(configSrc)) {
        copyFileSync(configSrc, join(codexHomeTmp, 'config.toml'));
      } else {
        console.warn(
          `[acp] WARNING: ${configSrc} not found — codex model config may be missing`,
        );
      }

      return {
        cwd: opts.cwd,
        env: { ...opts.env, CODEX_HOME: codexHomeTmp },
        cleanup: () => {
          try {
            rmSync(codexHomeTmp, { recursive: true, force: true });
          } catch {
            /* best-effort cleanup */
          }
        },
      };
    }

    case 'claude':
    default: {
      // claude: auth comes from the host (Claude Code OAuth or
      // ANTHROPIC_API_KEY). No cwd config, no env override.
      return { cwd: opts.cwd, env: opts.env };
    }
  }
}
