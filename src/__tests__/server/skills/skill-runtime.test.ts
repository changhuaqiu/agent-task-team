import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { skillRepo } from '@/server/repositories/skill-repo';
import { RepositorySkillRuntime } from '@/server/skills/skill-runtime';
import { buildSkillPackageInput } from '@/test-helpers/skill-package';

let db: Database.Database;
let tempDir: string;
let previousDataDir: string | undefined;

beforeEach(async () => {
  db = createTestDb();
  setTestDb(db);
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ath-skill-runtime-'));
  previousDataDir = process.env.ATH_DATA_DIR;
  process.env.ATH_DATA_DIR = tempDir;
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetDb();
  resetSeq();
  if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
  else process.env.ATH_DATA_DIR = previousDataDir;
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('RepositorySkillRuntime', () => {
  it('installs an immutable package and compiles only SKILL.md with resource references', async () => {
    const runtime = new RepositorySkillRuntime();
    const revision = await runtime.install(buildSkillPackageInput({
      name: 'code-review',
      description: 'Review code changes safely',
      content: 'Check correctness first.',
      files: [
        { path: 'references/guide.md', content: 'Long guide body' },
        { path: 'scripts/check.ts', content: 'export const check = true;' },
      ],
    }));

    const compiled = await runtime.compile({ skillIds: [revision.skillId] });
    expect(compiled.catalog[0]).toMatchObject({ name: 'code-review', revision: revision.revision });
    expect(compiled.activated[0].body).toBe('Check correctness first.');
    expect(compiled.activated[0].resourceRefs).toHaveLength(2);
    expect(compiled.activated[0].body).not.toContain('Long guide body');
    expect(skillRepo.listRevisionFiles(revision.revision)).toHaveLength(2);
  });

  it('is idempotent for the same content and creates a new revision after an edit', async () => {
    const runtime = new RepositorySkillRuntime();
    const first = await runtime.install(buildSkillPackageInput({
      name: 'code-review', description: 'Review safely', content: 'Version one.', files: [],
    }));
    const same = await runtime.install(buildSkillPackageInput({
      name: 'code-review', description: 'Review safely', content: 'Version one.', files: [],
    }));
    const second = await runtime.install(buildSkillPackageInput({
      name: 'code-review', description: 'Review safely', content: 'Version two.', files: [],
    }));

    expect(same.revision).toBe(first.revision);
    expect(second.revision).not.toBe(first.revision);
    expect(skillRepo.getActiveRevision(first.skillId)?.id).toBe(second.revision);
  });

  it('versions behavior config with the package instead of reading mutable skill state', async () => {
    const runtime = new RepositorySkillRuntime();
    const first = await runtime.install(buildSkillPackageInput({
      name: 'configured-skill', description: 'Configured', content: 'Use configured tools.', files: [], config: '{"tools":["Read"]}',
    }));
    const second = await runtime.install(buildSkillPackageInput({
      name: 'configured-skill', description: 'Configured', content: 'Use configured tools.', files: [], config: '{"tools":["Read","Write"]}',
    }));
    const compiled = await runtime.compile({ skillIds: [second.skillId] });

    expect(second.revision).not.toBe(first.revision);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(compiled.activated[0].config).toBe('{"tools":["Read","Write"]}');
  });

  it('migrates legacy display names without changing ids or colliding package paths', async () => {
    const runtime = new RepositorySkillRuntime();
    const legacyNames = ['Code Review', '代码审查', '代码 审查'];
    const skills = legacyNames.map((name) => skillRepo.create({ name, description: `${name} description`, content: `Use ${name}.` }));

    const compiled = await runtime.compile({ skillIds: skills.map((skill) => skill.id) });

    expect(compiled.activated.map((skill) => skill.skillId)).toEqual(skills.map((skill) => skill.id));
    expect(compiled.activated.map((skill) => skill.name)).toEqual(legacyNames);
    const packagePaths = skills.map((skill) => skillRepo.getActiveRevision(skill.id)?.package_path);
    expect(packagePaths.every(Boolean)).toBe(true);
    expect(new Set(packagePaths).size).toBe(legacyNames.length);
    for (const skill of skills) expect(skillRepo.getActiveRevision(skill.id)).toBeDefined();
  });

  it('rebuilds the active revision after a config-only edit', async () => {
    const runtime = new RepositorySkillRuntime();
    const first = await runtime.install(buildSkillPackageInput({
      name: 'config-edit', description: 'Config edit', content: 'Use tools.', files: [], config: '{"tools":["Read"]}',
    }));
    skillRepo.update(first.skillId, { config: '{"tools":["Write"]}' });

    const compiled = await runtime.compile({ skillIds: [first.skillId] });

    expect(compiled.activated[0].revision).not.toBe(first.revision);
    expect(compiled.activated[0].config).toBe('{"tools":["Write"]}');
  });

  it('fails closed when a required binding is missing or the installed package is modified', async () => {
    const runtime = new RepositorySkillRuntime();
    await expect(runtime.compile({ skillIds: ['missing'] })).rejects.toMatchObject({ reasonCode: 'required_skill_not_loaded' });
    await expect(runtime.compile({ skillIds: [], requiredSkillIds: ['missing'] })).rejects.toMatchObject({
      reasonCode: 'required_skill_not_loaded',
    });

    const revision = await runtime.install(buildSkillPackageInput({
      name: 'tamper-check', description: 'Detect modified package files', content: 'Original body.', files: [],
    }));
    await fs.writeFile(path.join(revision.packagePath, 'SKILL.md'), 'modified', 'utf8');
    await expect(runtime.install(buildSkillPackageInput({
      name: 'tamper-check', description: 'Detect modified package files', content: 'Original body.', files: [],
    }))).rejects.toMatchObject({ reasonCode: 'skill_revision_mismatch' });
    await expect(runtime.compile({ skillIds: [revision.skillId] })).rejects.toMatchObject({
      reasonCode: 'skill_manifest_invalid',
    });
  });

  it('separates eligible Skills from the routed activation set', async () => {
    const runtime = new RepositorySkillRuntime();
    const selected = await runtime.install(buildSkillPackageInput({
      name: 'selected-skill', description: 'Selected', content: 'Selected body.', files: [],
    }));
    const omitted = await runtime.install(buildSkillPackageInput({
      name: 'omitted-skill', description: 'Omitted', content: 'Omitted body.', files: [],
    }));

    const compiled = await runtime.compile({
      skillIds: [selected.skillId, omitted.skillId],
      activatedSkillIds: [selected.skillId],
      requiredSkillIds: [selected.skillId],
      activationReasons: { [selected.skillId]: 'task' },
    });

    expect(compiled.catalog).toHaveLength(2);
    expect(compiled.activated).toMatchObject([{ skillId: selected.skillId, reason: 'task', required: true }]);
    expect(compiled.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: selected.skillId, outcome: 'loaded', activationReason: 'task' }),
      expect.objectContaining({
        skillId: omitted.skillId,
        outcome: 'omitted',
        reasonCode: 'not_activated_for_execution_profile',
        tokens: 0,
      }),
    ]));
  });

  it('rolls back mutable skill records when revision persistence fails', async () => {
    const runtime = new RepositorySkillRuntime();
    vi.spyOn(skillRepo, 'createOrActivateRevision').mockImplementation(() => {
      throw new Error('revision write failed');
    });

    await expect(runtime.install(buildSkillPackageInput({
      name: 'atomic-install', description: 'Atomic install', content: 'Do not leave partial records.', files: [],
    }))).rejects.toThrow('revision write failed');
    expect(skillRepo.getByName('atomic-install')).toBeUndefined();
  });
});
