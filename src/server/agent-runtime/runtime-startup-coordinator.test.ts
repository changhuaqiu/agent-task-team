import { describe, expect, it } from 'vitest';
import { coordinateRuntimeStartup } from './runtime-startup-coordinator';

describe('coordinateRuntimeStartup', () => {
  it('serializes OpenCode cold starts while preserving their results', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = coordinateRuntimeStartup('opencode', async () => {
      events.push('first:start');
      await firstGate;
      events.push('first:end');
      return 'first';
    }, { cooldownMs: 0 });
    const second = coordinateRuntimeStartup('opencode', async () => {
      events.push('second:start');
      return 'second';
    }, { cooldownMs: 0 });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('does not serialize independent runtime implementations', async () => {
    const results = await Promise.all([
      coordinateRuntimeStartup('claude', async () => 'claude'),
      coordinateRuntimeStartup('codex', async () => 'codex'),
    ]);
    expect(results).toEqual(['claude', 'codex']);
  });
});
