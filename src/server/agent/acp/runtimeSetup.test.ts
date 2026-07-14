// src/server/agent/acp/runtimeSetup.test.ts
//
// Unit tests for the ACP/legacy routing selector + per-runtime setup helper.
// Pure + fast — NO real runtime is spawned. The real-runtime smoke lives in
// scripts/smoke-acp-runtime.ts.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chooseBackend,
  prepareAcpRuntime,
} from './runtimeSetup';
import { loadCatalog, type AgentCatalogEntry } from './catalog';

// ---------------------------------------------------------------------------
// chooseBackend (pure routing selector)
// ---------------------------------------------------------------------------

describe('chooseBackend — ACP/legacy routing selector', () => {
  const catalog = loadCatalog();

  it('routes to ACP for a prompt-verified engine when useAcp=true', () => {
    // All three seed runtimes have 'prompt' in verifiedCapabilities.
    for (const entry of catalog) {
      const choice = chooseBackend(entry.id, catalog, true);
      expect(choice.kind).toBe('acp');
      if (choice.kind === 'acp') {
        expect(choice.entry.id).toBe(entry.id);
        expect(choice.entry.verifiedCapabilities).toContain('prompt');
      }
    }
  });

  it('routes to legacy when useAcp=false (AGENT_BACKEND=legacy)', () => {
    const choice = chooseBackend('opencode', catalog, false);
    expect(choice.kind).toBe('legacy');
  });

  it('routes to legacy for an unknown engine even when useAcp=true', () => {
    const choice = chooseBackend('gemini', catalog, true);
    expect(choice.kind).toBe('legacy');
  });

  it('routes to legacy when the entry lacks prompt verification', () => {
    // Fabricate an entry missing 'prompt' from verifiedCapabilities.
    const unverified: AgentCatalogEntry[] = [
      {
        id: 'opencode',
        protocol: 'acp',
        delivery: 'native',
        launcher: { command: 'opencode', args: ['acp'] },
        verifiedCapabilities: ['initialize', 'newSession'], // NO 'prompt'
      },
    ];
    const choice = chooseBackend('opencode', unverified, true);
    expect(choice.kind).toBe('legacy');
  });

  it('returns the catalog entry (not a copy) on the ACP path', () => {
    const choice = chooseBackend('claude', catalog, true);
    expect(choice.kind).toBe('acp');
    if (choice.kind === 'acp') {
      // Same object identity — the daemon uses entry.launcher etc directly.
      expect(choice.entry).toBe(catalog.find((e) => e.id === 'claude'));
    }
  });
});

// ---------------------------------------------------------------------------
// prepareAcpRuntime (per-runtime setup)
// ---------------------------------------------------------------------------

describe('prepareAcpRuntime — per-runtime filesystem/env setup', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    // Best-effort cleanup of any temp dirs created by tests.
    for (const d of tmpDirs.splice(0)) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
  });

  const makeTempCwd = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'acp-setup-test-'));
    tmpDirs.push(d);
    return d;
  };

  it('opencode: writes cwd opencode.json with the fallback model when no OPENCODE_CONFIG', () => {
    const entry = loadCatalog().find((e) => e.id === 'opencode')!;
    const cwd = makeTempCwd();
    const result = prepareAcpRuntime(entry, { cwd, env: {} });

    expect(result.cwd).toBe(cwd);
    expect(result.cleanup).toBeUndefined();
    const configPath = join(cwd, 'opencode.json');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.model).toBe('deepseek/deepseek-chat');
  });

  it('opencode: does NOT write opencode.json when env already has OPENCODE_CONFIG (account config wins)', () => {
    const entry = loadCatalog().find((e) => e.id === 'opencode')!;
    const cwd = makeTempCwd();
    const result = prepareAcpRuntime(entry, {
      cwd,
      env: { OPENCODE_CONFIG: '/tmp/some-account-config.json' },
    });

    expect(existsSync(join(cwd, 'opencode.json'))).toBe(false);
    expect(result.env.OPENCODE_CONFIG).toBe('/tmp/some-account-config.json');
  });

  it('opencode: respects custom opencodeModel', () => {
    const entry = loadCatalog().find((e) => e.id === 'opencode')!;
    const cwd = makeTempCwd();
    prepareAcpRuntime(entry, {
      cwd,
      env: {},
      opencodeModel: 'anthropic/claude-sonnet-4',
    });
    const config = JSON.parse(readFileSync(join(cwd, 'opencode.json'), 'utf-8'));
    expect(config.model).toBe('anthropic/claude-sonnet-4');
  });

  it('codex: isolates CODEX_HOME into a temp dir + returns a cleanup fn', () => {
    const entry = loadCatalog().find((e) => e.id === 'codex')!;
    const cwd = makeTempCwd();
    const result = prepareAcpRuntime(entry, { cwd, env: { FOO: 'bar' } });

    // CODEX_HOME is set to a temp path.
    expect(result.env.CODEX_HOME).toBeDefined();
    expect(result.env.CODEX_HOME).not.toBe('');
    expect(result.env.FOO).toBe('bar'); // original env preserved
    expect(result.cwd).toBe(cwd);
    // Cleanup fn present.
    expect(typeof result.cleanup).toBe('function');

    // The temp CODEX_HOME exists (created by mkdtempSync).
    const codexHome = result.env.CODEX_HOME;
    expect(existsSync(codexHome)).toBe(true);

    // Cleanup removes it.
    result.cleanup?.();
    expect(existsSync(codexHome)).toBe(false);

    // Cleanup is idempotent (second call doesn't throw).
    expect(() => result.cleanup?.()).not.toThrow();
  });

  it('claude: passthrough — no cwd changes, no env override, no cleanup', () => {
    const entry = loadCatalog().find((e) => e.id === 'claude')!;
    const cwd = makeTempCwd();
    const result = prepareAcpRuntime(entry, { cwd, env: { X: '1' } });

    expect(result.cwd).toBe(cwd);
    expect(result.env).toEqual({ X: '1' });
    expect(result.cleanup).toBeUndefined();
    // No opencode.json written for claude.
    expect(existsSync(join(cwd, 'opencode.json'))).toBe(false);
  });
});
