import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startArtifactLoopbackServer } from './artifact-loopback-server';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('startArtifactLoopbackServer', () => {
  it('serves the exact project artifact once over 127.0.0.1', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'ath-artifact-loopback-'));
    tempDirs.push(projectDir);
    await writeFile(join(projectDir, 'DELIVERY_PROBE.md'), Buffer.from('DELIVERY_OK'));

    const result = await startArtifactLoopbackServer({
      projectDir,
      artifactPath: 'DELIVERY_PROBE.md',
      ttlMs: 2_000,
    });

    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(result.byteLength).toBe(11);
    const response = await fetch(result.url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(Buffer.from(await response.arrayBuffer()).toString('hex'))
      .toBe('44454c49564552595f4f4b');
    const replay = await fetch(result.url).catch(() => undefined);
    expect(replay?.status).not.toBe(200);
  });

  it('rejects paths outside the current project directory', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'ath-artifact-loopback-parent-'));
    tempDirs.push(parentDir);
    const projectDir = join(parentDir, 'project');
    await mkdir(projectDir);
    await writeFile(join(parentDir, 'secret.txt'), 'secret');

    await expect(startArtifactLoopbackServer({
      projectDir,
      artifactPath: '../secret.txt',
    })).rejects.toThrow('inside the current project directory');
  });
});
