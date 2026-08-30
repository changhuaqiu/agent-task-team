// src/server/agent/acp/catalog.test.ts
//
// Unit tests for the AgentCatalog (spec §5.1). Pure + fast — NO real runtime
// is spawned here. The real-runtime smoke lives in scripts/smoke-acp-runtime.ts.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect } from 'vitest';
import { loadCatalog, createBackend, resolveCatalogLauncher, validateCatalog } from './catalog';
import { AcpBackend } from './acpBackend';

describe('AgentCatalog (loadCatalog + createBackend)', () => {
  it('loadCatalog returns built-in and preset ACP entries with correct launchers', () => {
    const entries = loadCatalog();

    expect(entries).toHaveLength(13);

    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

    // --- opencode: native delivery, isolated `opencode --pure acp` launcher ---
    const opencode = byId['opencode'];
    expect(opencode).toBeDefined();
    expect(opencode.protocol).toBe('acp');
    expect(opencode.delivery).toBe('native');
    expect(opencode.launcher.command).toBe('opencode');
    expect(opencode.launcher.args).toEqual(['--pure', 'acp']);

    // --- claude: adapter delivery, pinned npx launcher ---
    const claude = byId['claude'];
    expect(claude).toBeDefined();
    expect(claude.delivery).toBe('adapter');
    expect(claude.launcher.command).toBe('npx');
    expect(claude.launcher.args).toEqual([
      '-y',
      '@agentclientprotocol/claude-agent-acp@0.59.0',
    ]);
    expect(claude.launcher.package).toBe('@agentclientprotocol/claude-agent-acp');
    expect(claude.launcher.version).toBe('0.59.0'); // locked version (spec §5.1)

    // --- codex: adapter delivery, pinned npx launcher ---
    const codex = byId['codex'];
    expect(codex).toBeDefined();
    expect(codex.delivery).toBe('adapter');
    expect(codex.launcher.command).toBe('npx');
    expect(codex.launcher.args).toEqual(['-y', '@agentclientprotocol/codex-acp@1.1.2']);
    expect(codex.launcher.version).toBe('1.1.2'); // locked version

    // Every entry exposes the same capability field. Presets stay empty until
    // a real-runtime probe verifies them on this product.
    for (const e of entries) {
      expect(Array.isArray(e.verifiedCapabilities)).toBe(true);
    }
    for (const id of ['opencode', 'claude', 'codex']) {
      expect(byId[id].verifiedCapabilities).toContain('initialize');
    }
    expect(byId['openclaw'].launcher).toEqual({ command: 'openclaw', args: ['acp'] });
    expect(byId['cursor'].launcher).toEqual({ command: 'cursor-agent', args: ['acp'] });
  });

  it('rejects duplicate ids and adapter launchers that are not actually pinned', () => {
    const entry = loadCatalog().find((candidate) => candidate.id === 'claude')!;
    expect(() => validateCatalog([entry, entry])).toThrow(/duplicate id/);
    expect(() => validateCatalog([{
      ...entry,
      launcher: { ...entry.launcher, args: ['-y', entry.launcher.package!] },
    }])).toThrow(/not pinned/);
  });

  it('createBackend(opencodeEntry) returns the unified AcpBackend', () => {
    const opencodeEntry = loadCatalog().find((e) => e.id === 'opencode')!;
    const backend = createBackend(opencodeEntry);

    // The backend is an AcpBackend instance.
    expect(backend).toBeInstanceOf(AcpBackend);

  });

  it('createBackend passes cwd + env through to the AcpBackend', () => {
    // AcpBackend stores opts.cwd + opts.env; execute() falls back to / merges
    // them. We verify the backend constructs without error and that env is plumbed through to
    // the backend's options (the codex smoke + Task 8 daemon rely on this to
    // isolate CODEX_HOME). The cwd/env values themselves are exercised by the
    // real-runtime smoke; here we just confirm the wiring.
    const cwd = '/tmp/catalog-test-cwd';
    const env = { CODEX_HOME: '/tmp/catalog-test-codex-home' };
    for (const entry of loadCatalog()) {
      const backend = createBackend(entry, { cwd, env });
      expect(backend).toBeInstanceOf(AcpBackend);
      // Access the private opts to confirm env passthrough (test file is
      // excluded from tsc; vitest transpiles via esbuild without type-check).
      const opts = (backend as unknown as { o: { cwd?: string; env?: Record<string, string> } }).o;
      expect(opts.cwd).toBe(cwd);
      expect(opts.env).toEqual(env);
    }
  });

  it('enables native subagent forwarding by default only for Claude', () => {
    const claudeEntry = loadCatalog().find((entry) => entry.id === 'claude')!;
    const claudeBackend = createBackend(claudeEntry);
    const claudeOpts = (claudeBackend as unknown as {
      o: { forwardNativeSubagentText?: boolean };
    }).o;
    expect(claudeOpts.forwardNativeSubagentText).toBe(true);

    const opencodeEntry = loadCatalog().find((entry) => entry.id === 'opencode')!;
    const opencodeBackend = createBackend(opencodeEntry);
    const opencodeOpts = (opencodeBackend as unknown as {
      o: { forwardNativeSubagentText?: boolean };
    }).o;
    expect(opencodeOpts.forwardNativeSubagentText).toBe(false);
  });

  it('prefers the installed pinned adapter binary over spawning npx', () => {
    const claudeEntry = loadCatalog().find((entry) => entry.id === 'claude')!;
    const launcher = resolveCatalogLauncher(claudeEntry, process.cwd());

    expect(launcher.command.replace(/\\/g, '/')).toMatch(
      /node_modules\/.bin\/claude-agent-acp(?:\.cmd)?$/,
    );
    expect(launcher.args).toEqual([]);
  });

  it('keeps the pinned catalog launcher as fallback when dependencies are external', () => {
    const claudeEntry = loadCatalog().find((entry) => entry.id === 'claude')!;

    expect(resolveCatalogLauncher(claudeEntry, '/missing-agent-task-hub')).toEqual({
      command: 'npx',
      args: ['-y', '@agentclientprotocol/claude-agent-acp@0.59.0'],
    });
  });
});
