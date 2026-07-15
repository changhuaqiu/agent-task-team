// src/server/agent/acp/runtimeSetup.test.ts
//
// Unit tests for the per-runtime ACP setup helper.
// Pure + fast — NO real runtime is spawned. The real-runtime smoke lives in
// scripts/smoke-acp-runtime.ts.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAcpRuntime } from './runtimeSetup';
import { loadCatalog } from './catalog';

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

  it('opencode: writes an isolated config without changing the project cwd', () => {
    const entry = loadCatalog().find((e) => e.id === 'opencode')!;
    const cwd = makeTempCwd();
    const result = prepareAcpRuntime(entry, { cwd, env: {} });

    expect(result.cwd).toBe(cwd);
    expect(typeof result.cleanup).toBe('function');
    expect(existsSync(join(cwd, 'opencode.json'))).toBe(false);
    const configPath = result.env.OPENCODE_CONFIG;
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    expect(config.model).toBe('deepseek/deepseek-chat');
    result.cleanup?.();
    expect(existsSync(configPath)).toBe(false);
    expect(() => result.cleanup?.()).not.toThrow();
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
    const result = prepareAcpRuntime(entry, {
      cwd,
      env: {},
      opencodeModel: 'anthropic/claude-sonnet-4',
    });
    const config = JSON.parse(readFileSync(result.env.OPENCODE_CONFIG, 'utf-8'));
    expect(config.model).toBe('anthropic/claude-sonnet-4');
    result.cleanup?.();
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
