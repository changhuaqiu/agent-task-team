// src/server/agent/acp/catalog.test.ts
//
// Unit tests for the AgentCatalog (spec §5.1). Pure + fast — NO real runtime
// is spawned here. The real-runtime smoke lives in scripts/smoke-acp-runtime.ts.
//
// This file is excluded from tsc (tsconfig exclude **/*.test.ts); vitest
// transpiles via esbuild without type-checking.

import { describe, it, expect } from 'vitest';
import { loadCatalog, createBackend } from './catalog';
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
    expect(opencode.legacyBackend).toBeUndefined(); // native → no legacy path

    // --- claude: adapter delivery, npx launcher, legacy backend kept ---
    const claude = byId['claude'];
    expect(claude).toBeDefined();
    expect(claude.delivery).toBe('adapter');
    expect(claude.launcher.command).toBe('npx');
    expect(claude.launcher.args).toEqual([
      '-y',
      '@agentclientprotocol/claude-agent-acp',
    ]);
    expect(claude.legacyBackend).toBe('claude');
    expect(claude.launcher.package).toBe('@agentclientprotocol/claude-agent-acp');
    expect(claude.launcher.version).toBe('0.59.0'); // locked version (spec §5.1)

    // --- codex: adapter delivery, npx launcher, legacy backend kept ---
    const codex = byId['codex'];
    expect(codex).toBeDefined();
    expect(codex.delivery).toBe('adapter');
    expect(codex.launcher.command).toBe('npx');
    expect(codex.launcher.args).toEqual(['-y', '@agentclientprotocol/codex-acp']);
    expect(codex.legacyBackend).toBe('codex');
    expect(codex.launcher.version).toBe('1.1.2'); // locked version

    // Every entry has verifiedCapabilities (at least initialize from T1 probe).
    for (const e of entries) {
      expect(Array.isArray(e.verifiedCapabilities)).toBe(true);
      expect(e.verifiedCapabilities).toContain('initialize');
    }
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

  it('createBackend passes cwd through to the AcpBackend', () => {
    // AcpBackend stores opts.cwd; execute() falls back to it. We verify the
    // backend constructs without error and retains the engine identity for
    // each catalog runtime (the cwd path itself is exercised by the smoke).
    const cwd = '/tmp/catalog-test-cwd';
    for (const entry of loadCatalog()) {
      const backend = createBackend(entry, cwd);
      expect(backend).toBeInstanceOf(AcpBackend);
      expect(backend.capabilities.engine).toBe(entry.id);
    }
  });
});
