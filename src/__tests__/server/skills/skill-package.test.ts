import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifySkillResource,
  computeSkillPackageHash,
  normalizeSkillRelativePath,
  parseSkillMarkdown,
} from '@/server/skills/skill-package';
import { scanSkillsDir } from '@/server/skill-import';

const markdown = `---
name: code-review
description: Review code changes safely
---

Check correctness first.`;
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

describe('skill package', () => {
  it('parses the standard SKILL.md contract', () => {
    expect(parseSkillMarkdown(markdown)).toEqual({
      name: 'code-review',
      description: 'Review code changes safely',
      body: 'Check correctness first.',
    });
  });

  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeSkillRelativePath('../secret')).toThrow('Invalid skill file path');
    expect(() => normalizeSkillRelativePath('C:\\secret')).toThrow('Invalid skill file path');
  });

  it('classifies progressive resources and hashes independently of file order', () => {
    expect(classifySkillResource('references/guide.md')).toBe('reference');
    expect(classifySkillResource('scripts/check.ts')).toBe('script');
    expect(classifySkillResource('assets/example.png')).toBe('asset');
    const base = {
      name: 'code-review', description: 'Review code changes safely', body: 'Check correctness first.', skillMarkdown: markdown,
    };
    const a = { ...base, files: [
      { path: 'references/guide.md', content: Buffer.from('guide') },
      { path: 'scripts/check.ts', content: Buffer.from('check') },
    ] };
    const b = { ...base, files: [...a.files].reverse() };
    expect(computeSkillPackageHash(a)).toBe(computeSkillPackageHash(b));
  });

  it('rejects paths that collide on case-insensitive filesystems', () => {
    const input = {
      name: 'code-review', description: 'Review code changes safely', body: 'Check correctness first.', skillMarkdown: markdown,
      files: [
        { path: 'references/A.md', content: Buffer.from('A') },
        { path: 'references/a.md', content: Buffer.from('a') },
      ],
    };
    expect(() => computeSkillPackageHash(input)).toThrow('Duplicate skill file path');
  });

  it('discovers a single-skill repository with SKILL.md at its root', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ath-single-skill-'));
    tempDirs.push(root);
    await fs.writeFile(path.join(root, 'SKILL.md'), markdown, 'utf8');
    await fs.mkdir(path.join(root, 'references'));
    await fs.writeFile(path.join(root, 'references', 'guide.md'), 'guide', 'utf8');
    await fs.mkdir(path.join(root, '.git'));
    await fs.writeFile(path.join(root, '.git', 'config'), 'repository metadata', 'utf8');

    const result = await scanSkillsDir(root);
    expect(result.errors).toEqual([]);
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]).toMatchObject({ name: 'code-review' });
    expect(result.packages[0].files.map(file => file.path)).toEqual(['references/guide.md']);
  });
});
