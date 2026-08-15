import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type {
  InstalledSkillRevision,
  SkillCompileRequest,
  SkillCompileResult,
  SkillPackageInput,
  SkillRuntime as SkillRuntimeInterface,
} from '@/lib/skills/types';
import { skillRepo, type SkillRevisionRow, type SkillRow } from '../repositories/skill-repo';
import { getDb } from '../db';
import {
  classifySkillResource,
  computeInstalledPackageHash,
  computeSkillPackageHash,
  normalizeSkillRelativePath,
  SkillPackageError,
  validateSkillPackage,
} from './skill-package';

export class SkillRuntimeError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'SkillRuntimeError';
  }
}

function dataDir(): string {
  return process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
}

function packageRoot(): string {
  return path.join(dataDir(), 'skill-packages');
}

function canonicalSkillMarkdown(name: string, description: string, body: string): string {
  const yamlDescription = JSON.stringify(description);
  return `---\nname: ${name}\ndescription: ${yamlDescription}\n---\n\n${body.trim()}\n`;
}

function sha256(content: Uint8Array): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function safeSegment(value: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SkillRuntimeError('skill_manifest_invalid', `Invalid skill name: ${value}`);
  }
  return value;
}

async function writePackageAtomically(input: SkillPackageInput, contentHash: string): Promise<string> {
  const finalPath = path.join(packageRoot(), safeSegment(input.name), contentHash);
  const existing = await fs.stat(finalPath).catch(() => undefined);
  if (existing?.isDirectory()) {
    const existingHash = await computeInstalledPackageHash(finalPath, input.config).catch(() => undefined);
    if (existingHash !== contentHash) {
      throw new SkillRuntimeError('skill_revision_mismatch', `Existing package hash mismatch for skill ${input.name}`);
    }
    return finalPath;
  }

  const parent = path.dirname(finalPath);
  await fs.mkdir(parent, { recursive: true });
  const tempPath = path.join(parent, `.tmp-${contentHash}-${crypto.randomBytes(4).toString('hex')}`);
  await fs.mkdir(tempPath, { recursive: false });
  try {
    await fs.writeFile(path.join(tempPath, 'SKILL.md'), input.skillMarkdown.replace(/\r\n/g, '\n'), 'utf8');
    for (const file of input.files) {
      const relativePath = normalizeSkillRelativePath(file.path);
      const absolute = path.join(tempPath, ...relativePath.split('/'));
      await fs.mkdir(path.dirname(absolute), { recursive: true });
      await fs.writeFile(absolute, file.content);
    }
    await fs.rename(tempPath, finalPath).catch(async error => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
  } finally {
    await fs.rm(tempPath, { recursive: true, force: true }).catch(() => undefined);
  }
  return finalPath;
}

function revisionToInstalled(skill: SkillRow, revision: SkillRevisionRow): InstalledSkillRevision {
  const resourceRefs = skillRepo.listRevisionFiles(revision.id)
    .filter(file => file.kind !== 'agent_metadata')
    .map(file => path.join(revision.package_path, ...file.path.split('/')));
  return {
    id: revision.id,
    skillId: skill.id,
    name: skill.name,
    description: revision.description,
    revision: revision.id,
    contentHash: revision.content_hash,
    packagePath: revision.package_path,
    body: revision.body,
    resourceRefs,
    config: revision.config ?? undefined,
    createdAt: revision.created_at,
  };
}

function legacyPackageSlug(skill: SkillRow): string {
  const normalized = skill.name.normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'legacy-skill';
  const suffix = sha256(Buffer.from(skill.id, 'utf8')).slice(0, 12);
  return `${normalized.slice(0, 48).replace(/-+$/g, '')}-${suffix}`;
}

function legacyPackage(skill: SkillRow): SkillPackageInput {
  const description = skill.description?.trim() || `Use the ${skill.name} skill when its assigned role handles this work.`;
  const files = skillRepo.listFiles(skill.id).map(file => ({
    path: normalizeSkillRelativePath(file.path),
    content: Buffer.from(file.content, 'utf8'),
  }));
  const packageName = legacyPackageSlug(skill);
  const skillMarkdown = canonicalSkillMarkdown(packageName, description, skill.content);
  return {
    name: packageName,
    description,
    body: skill.content.trim(),
    skillMarkdown,
    files,
    config: skill.config ?? undefined,
    isPreset: Boolean(skill.is_preset),
  };
}

export class RepositorySkillRuntime implements SkillRuntimeInterface {
  async install(source: SkillPackageInput): Promise<InstalledSkillRevision> {
    const input = validateSkillPackage(source);
    const contentHash = computeSkillPackageHash(input);
    const packagePath = await writePackageAtomically(input, contentHash);
    return getDb().transaction(() => {
      let skill = skillRepo.getByName(input.name);
      if (skill) {
        skillRepo.update(skill.id, {
          description: input.description,
          content: input.body,
          ...(input.config !== undefined ? { config: input.config } : {}),
        });
        const textFiles = input.files
          .filter(file => classifySkillResource(file.path) !== 'asset')
          .map(file => ({ path: normalizeSkillRelativePath(file.path), content: Buffer.from(file.content).toString('utf8') }));
        skillRepo.replaceFiles(skill.id, textFiles);
        skill = skillRepo.getById(skill.id)!;
      } else {
        skill = skillRepo.create({
          name: input.name,
          description: input.description,
          content: input.body,
          config: input.config,
          isPreset: input.isPreset,
        });
        for (const file of input.files) {
          if (classifySkillResource(file.path) === 'asset') continue;
          skillRepo.addFile(skill.id, {
            path: normalizeSkillRelativePath(file.path),
            content: Buffer.from(file.content).toString('utf8'),
          });
        }
      }

      const revision = skillRepo.createOrActivateRevision({
        skillId: skill.id,
        contentHash,
        description: input.description,
        body: input.body,
        packagePath,
        config: input.config,
        files: input.files.map(file => ({
          path: normalizeSkillRelativePath(file.path),
          kind: classifySkillResource(file.path),
          content_hash: sha256(file.content),
          byte_size: file.content.byteLength,
        })),
      });
      return revisionToInstalled(skillRepo.getById(skill.id)!, revision);
    })();
  }

  private async ensureRevision(skill: SkillRow): Promise<InstalledSkillRevision> {
    const active = skillRepo.getActiveRevision(skill.id);
    if (!active) {
      let input: SkillPackageInput;
      try {
        input = validateSkillPackage(legacyPackage(skill));
      } catch (error) {
        if (error instanceof SkillPackageError) {
          throw new SkillRuntimeError(error.reasonCode, error.message);
        }
        throw error;
      }
      const contentHash = computeSkillPackageHash(input);
      const packagePath = await writePackageAtomically(input, contentHash);
      return getDb().transaction(() => {
        const revision = skillRepo.createOrActivateRevision({
          skillId: skill.id,
          contentHash,
          description: input.description,
          body: input.body,
          packagePath,
          config: input.config,
          files: input.files.map(file => ({
            path: normalizeSkillRelativePath(file.path),
            kind: classifySkillResource(file.path),
            content_hash: sha256(file.content),
            byte_size: file.content.byteLength,
          })),
        });
        return revisionToInstalled(skillRepo.getById(skill.id)!, revision);
      })();
    }
    const packageStat = await fs.stat(active.package_path).catch(() => undefined);
    if (!packageStat?.isDirectory()) {
      throw new SkillRuntimeError('skill_package_missing', `Installed package is missing for skill ${skill.name}`);
    }
    const installedHash = await computeInstalledPackageHash(active.package_path, active.config ?? undefined).catch(error => {
      if (error instanceof SkillPackageError) {
        throw new SkillRuntimeError(error.reasonCode, error.message);
      }
      throw error;
    });
    if (installedHash !== active.content_hash) {
      throw new SkillRuntimeError('skill_revision_mismatch', `Installed package hash mismatch for skill ${skill.name}`);
    }
    return revisionToInstalled(skill, active);
  }

  async compile(input: SkillCompileRequest): Promise<SkillCompileResult> {
    const skillIds = Array.from(new Set(input.skillIds));
    const required = new Set(input.requiredSkillIds ?? skillIds);
    for (const requiredSkillId of required) {
      if (!skillIds.includes(requiredSkillId)) {
        throw new SkillRuntimeError('required_skill_not_loaded', `Required skill is not eligible: ${requiredSkillId}`);
      }
    }
    const installed: InstalledSkillRevision[] = [];
    for (const skillId of skillIds) {
      const skill = skillRepo.getById(skillId);
      if (!skill) {
        if (required.has(skillId)) {
          throw new SkillRuntimeError('required_skill_not_loaded', `Required skill not found: ${skillId}`);
        }
        continue;
      }
      const requestedRevisionId = input.revisionIds?.[skillId];
      if (!requestedRevisionId) {
        installed.push(await this.ensureRevision(skill));
        continue;
      }
      const revision = skillRepo.getRevisionById(requestedRevisionId);
      if (!revision || revision.skill_id !== skillId) {
        throw new SkillRuntimeError(
          'skill_revision_mismatch',
          `Requested revision ${requestedRevisionId} does not belong to skill ${skillId}`,
        );
      }
      const packageStat = await fs.stat(revision.package_path).catch(() => undefined);
      if (!packageStat?.isDirectory()) {
        throw new SkillRuntimeError('skill_package_missing', `Installed package is missing for skill ${skill.name}`);
      }
      const installedHash = await computeInstalledPackageHash(revision.package_path, revision.config ?? undefined)
        .catch(error => {
          if (error instanceof SkillPackageError) {
            throw new SkillRuntimeError(error.reasonCode, error.message);
          }
          throw error;
        });
      if (installedHash !== revision.content_hash) {
        throw new SkillRuntimeError('skill_revision_mismatch', `Installed package hash mismatch for skill ${skill.name}`);
      }
      installed.push(revisionToInstalled(skill, revision));
    }

    return {
      catalog: installed.map(skill => ({
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        revision: skill.revision,
      })),
      activated: installed.map(skill => ({
        skillId: skill.skillId,
        name: skill.name,
        description: skill.description,
        revision: skill.revision,
        contentHash: skill.contentHash,
        body: skill.body,
        resourceRefs: skill.resourceRefs,
        reason: 'agent_binding',
        required: required.has(skill.skillId),
        config: skill.config,
      })),
      decisions: installed.map(skill => ({
        skillId: skill.skillId,
        name: skill.name,
        revision: skill.revision,
        contentHash: skill.contentHash,
        outcome: 'loaded',
        reasonCode: 'compiled_from_agent_binding',
        activationReason: 'agent_binding',
        tokens: Math.ceil(skill.body.length / 4),
      })),
    };
  }
}

export const skillRuntime = new RepositorySkillRuntime();
