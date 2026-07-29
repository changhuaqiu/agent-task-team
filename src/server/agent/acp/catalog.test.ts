// src/server/agent/acp/catalog.test.ts
//
// Unit tests for the AgentCatalog (spec §5.1). Pure + fast — NO real runtime
// is spawned here. The real-runtime smoke lives in scripts/smoke-acp-runtime.ts.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect } from 'vitest';
import { loadCatalog, createBackend, validateCatalog } from './catalog';
import { AcpBackend } from './acpBackend';

describe('AgentCatalog (loadCatalog + createBackend)', () => {
  it('loadCatalog returns the 3 seed entries with correct delivery + launcher', () => {
    const entries = loadCatalog();

    expect(entries).toHaveLength(3);

    const byId = Object.fromEntries(entries.map((e) => [e.id, e]));

    // --- opencode: native delivery, bare `opencode acp` launcher ---
    const opencode = byId['opencode'];
    expect(opencode).toBeDefined();
    expect(opencode.protocol).toBe('acp');
    expect(opencode.delivery).toBe('native');
    expect(opencode.launcher.command).toBe('opencode');
    expect(opencode.launcher.args).toEqual(['acp']);

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

    // Every entry has verifiedCapabilities (at least initialize from T1 probe).
    for (const e of entries) {
      expect(Array.isArray(e.verifiedCapabilities)).toBe(true);
      expect(e.verifiedCapabilities).toContain('initialize');
    }
  });

  it('rejects duplicate ids and adapter launchers that are not actually pinned', () => {
    const entry = loadCatalog()[1];
    expect(() => validateCatalog([entry, entry])).toThrow(/duplicate id/);
    expect(() => validateCatalog([{
      ...entry,
      launcher: { ...entry.launcher, args: ['-y', entry.launcher.package!] },
    }])).toThrow(/not pinned/);
  });

  it('createBackend(opencodeEntry) returns an AcpBackend with engine=opencode + requiresPty=false', () => {
    const opencodeEntry = loadCatalog().find((e) => e.id === 'opencode')!;
    const backend = createBackend(opencodeEntry);

    // The backend is an AcpBackend instance.
    expect(backend).toBeInstanceOf(AcpBackend);

    // Capabilities reflect the engine identity + ACP's no-PTY advantage.
    expect(backend.capabilities.engine).toBe('opencode');
    expect(backend.capabilities.requiresPty).toBe(false);
    expect(backend.capabilities.outputMode).toBe('events');
  });

  it('createBackend passes cwd + env through to the AcpBackend', () => {
    // AcpBackend stores opts.cwd + opts.env; execute() falls back to / merges
    // them. We verify the backend constructs without error, retains the engine
    // identity for each catalog runtime, and that env is plumbed through to
    // the backend's options (the codex smoke + Task 8 daemon rely on this to
    // isolate CODEX_HOME). The cwd/env values themselves are exercised by the
    // real-runtime smoke; here we just confirm the wiring.
    const cwd = '/tmp/catalog-test-cwd';
    const env = { CODEX_HOME: '/tmp/catalog-test-codex-home' };
    for (const entry of loadCatalog()) {
      const backend = createBackend(entry, { cwd, env });
      expect(backend).toBeInstanceOf(AcpBackend);
      expect(backend.capabilities.engine).toBe(entry.id);
      // Access the private opts to confirm env passthrough (test file is
      // excluded from tsc; vitest transpiles via esbuild without type-check).
      const opts = (backend as unknown as { o: { cwd?: string; env?: Record<string, string> } }).o;
      expect(opts.cwd).toBe(cwd);
      expect(opts.env).toEqual(env);
    }
  });

  it('createBackend carries native subagent forwarding into the ACP backend', () => {
    const claudeEntry = loadCatalog().find((entry) => entry.id === 'claude')!;
    const backend = createBackend(claudeEntry, { forwardNativeSubagentText: true });
    const opts = (backend as unknown as {
      o: { forwardNativeSubagentText?: boolean };
    }).o;

    expect(opts.forwardNativeSubagentText).toBe(true);
  });
});
