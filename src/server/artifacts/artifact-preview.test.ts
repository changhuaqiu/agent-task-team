import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readArtifactPreview, readProjectFilePreview } from './artifact-preview';
import { projectArtifactLedger } from './project-artifact-ledger';
import { createTestDb, setTestDb, resetDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
let sandbox: string, root: string;
beforeEach(async () => {
  setTestDb(createTestDb());
  sandbox = await mkdtemp(path.join(os.tmpdir(), 'ath-preview-test-'));
  root = path.join(sandbox, 'project');
  await mkdir(root);
});
afterEach(async () => { vi.restoreAllMocks(); resetDb(); await rm(sandbox, { recursive: true, force: true }); });
describe('safe artifact preview', () => {
  it('returns escaped-by-consumer text, current-file hash, and redacted credentials', async () => {
    await writeFile(path.join(root, 'result.html'), '<script>alert(1)</script>\napi_key=example-secret-value');
    const result = await readProjectFilePreview(root, 'result.html');
    expect(result).toMatchObject({ kind: 'text', redacted: true, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    if (result.kind !== 'text') throw new Error('expected text');
    expect(result.content).toContain('<script>');
    expect(result.content).toContain('[REDACTED]');
    expect(result.content).not.toContain('example-secret-value');
  });
  it.each(['../outside.md', '.env', '.git/config', '.ath/log.md', '.ssh/id_rsa', 'secret.json', 'data.sqlite', 'https://example.test/a.md'])('refuses sensitive or escaping path %s', async (ref) => {
    await expect(readProjectFilePreview(root, ref)).rejects.toThrow('preview_forbidden');
  });
  it('refuses absolute and symlink paths outside the project', async () => {
    await writeFile(path.join(sandbox, 'outside.md'), 'private');
    await mkdir(path.join(sandbox, 'outside'));
    await writeFile(path.join(sandbox, 'outside', 'value.md'), 'private');
    await symlink(path.join(sandbox, 'outside'), path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(readProjectFilePreview(root, path.join(sandbox, 'outside.md'))).rejects.toThrow('preview_forbidden');
    await expect(readProjectFilePreview(root, 'linked/value.md')).rejects.toThrow('preview_forbidden');
  });
  it('bounds large files and refuses disguised binary text', async () => {
    await writeFile(path.join(root, 'large.md'), 'a'.repeat(256 * 1024 + 1));
    await writeFile(path.join(root, 'binary.md'), Buffer.from([65, 0, 66]));
    await expect(readProjectFilePreview(root, 'large.md')).rejects.toThrow('preview_too_large');
    await expect(readProjectFilePreview(root, 'binary.md')).rejects.toThrow('preview_unsupported');
  });
  it('cannot read arbitrary files through an unregistered artifact or raw ref', async () => {
    const p = projectRepo.create({ name: 'Preview', rootPath: root });
    await writeFile(path.join(root, 'allowed.md'), 'allowed');
    vi.spyOn(projectArtifactLedger, 'list').mockReturnValue([]);
    await expect(readArtifactPreview({ projectId: p.id, artifactId: 'unknown' })).rejects.toThrow('preview_not_found');
    await expect(readArtifactPreview({ projectId: p.id, ref: 'allowed.md' })).rejects.toThrow('preview_not_found');
  });
});
