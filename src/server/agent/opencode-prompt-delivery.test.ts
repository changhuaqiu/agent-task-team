import { describe, expect, it } from 'vitest';
import { buildOpenCodeRunArgs } from './opencode-prompt-delivery';

describe('buildOpenCodeRunArgs', () => {
  it('keeps bootstrap context out of the user prompt channel', () => {
    const args = buildOpenCodeRunArgs({
      prompt: 'implement task',
      sessionId: 'session-1',
    });

    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--session',
      'session-1',
      'implement task',
    ]);
    expect(args.join('\n')).not.toContain('IDENTITY OVERRIDE');
  });
});
