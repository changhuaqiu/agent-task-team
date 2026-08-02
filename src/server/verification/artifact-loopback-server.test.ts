import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('rejects a project junction that resolves outside the project', async () => {
    const parentDir = await mkdtemp(join(tmpdir(), 'ath-artifact-loopback-link-'));
    tempDirs.push(parentDir);
    const projectDir = join(parentDir, 'project');
    const outsideDir = join(parentDir, 'outside');
    await mkdir(projectDir);
    await mkdir(outsideDir);
    await writeFile(join(outsideDir, 'secret.txt'), 'secret');
    await symlink(outsideDir, join(projectDir, 'linked'), 'junction');

    await expect(startArtifactLoopbackServer({
      projectDir,
      artifactPath: 'linked/secret.txt',
    })).rejects.toThrow('inside the current project directory');
  });

  it('rejects artifacts above the bounded verification size', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'ath-artifact-loopback-large-'));
    tempDirs.push(projectDir);
    await writeFile(join(projectDir, 'large.bin'), Buffer.alloc(10 * 1024 * 1024 + 1));

    await expect(startArtifactLoopbackServer({
      projectDir,
      artifactPath: 'large.bin',
    })).rejects.toThrow('verification limit');
  });
});
