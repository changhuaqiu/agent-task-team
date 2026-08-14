import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('account runtime reachability architecture', () => {
  it('keeps provider-to-engine mapping in one production owner', () => {
    const owners = [
      'src/lib/account-auth.ts',
      'src/store/agentStore.ts',
      'src/lib/team-runtime/resolveRuntimeAgentProfile.ts',
    ].filter((path) => /const PROVIDER_TO_ENGINE/.test(source(path)));
    expect(owners).toEqual(['src/lib/account-auth.ts']);
  });

  it('does not retain vendor or unconditional probes for OpenCode-routed providers', () => {
    const probe = source('src/server/cli-probe.ts');
    expect(probe).not.toMatch(/\b(?:gemini|kimi|other):\s*\(/);
    expect(probe).not.toContain('echo "ok"');
    const verify = source('src/pages/api/accounts/verify.ts');
    expect(verify).toContain('generateRuntimeConfig');
    expect(verify).toContain("tryCliProbe('opencode'");
  });

  it('keeps cross-platform spawning inside the sole ACP backend without probe wrappers', () => {
    const backend = source('src/server/agent/acp/acpBackend.ts');
    expect(backend).toContain("import spawn from 'cross-spawn'");
    expect(backend).toContain('proc = spawn(this.o.command, this.o.args');
    expect(backend).not.toContain('probeCli');
    expect(backend).not.toContain('tryCliProbe');
    expect(source('src/server/agent/acp/catalog.ts')).not.toContain('cross-spawn');
  });
});
