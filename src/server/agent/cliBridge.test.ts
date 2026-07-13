import { describe, it, expect } from 'vitest';
import { probeCli } from './cliBridge';

describe('probeCli（cli-probe 并入中转层）', () => {
  it('未知 CLI 返回 ok:false', async () => {
    const result = await probeCli('unknown-cli');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('unknown');
  });

  it('非法 model 名返回 ok:false', async () => {
    const result = await probeCli('claude', { model: 'bad model; rm -rf' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('invalid');
  });
});
