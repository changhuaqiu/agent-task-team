import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { SkillPackageInput } from '@/lib/skills/types';
import { loadSkillPackageDirectory, SkillPackageError } from './skills/skill-package';
import { skillRuntime } from './skills/skill-runtime';

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const CLONE_TIMEOUT_MS = 30_000; // 30 seconds

function classifyCloneError(err: Error): Error {
  const msg = err.message.toLowerCase();
  if (msg.includes('timed out') || msg.includes('timeout') || msg.includes('recv failure') || msg.includes('could not resolve')) {
    return new Error('网络连接失败，无法访问该仓库。请检查网络连接或代理设置。');
  }
  if (msg.includes('not found') || msg.includes('404') || msg.includes('does not exist') || msg.includes("couldn't find remote ref")) {
    return new Error('仓库不存在，请检查 URL 是否正确。');
  }
  if (msg.includes('authentication') || msg.includes('403') || msg.includes('permission denied') || msg.includes('could not read from remote')) {
    return new Error('仓库需要认证或无访问权限。仅支持公开仓库。');
  }
  return new Error(`克隆仓库失败: ${err.message}`);
}

async function cloneRepo(repoUrl: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', ['clone', '--depth', '1', repoUrl, targetDir], (err) => {
      clearTimeout(timeout);
      if (err) reject(classifyCloneError(err)); else resolve();
    });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('克隆超时（30秒），请检查网络连接。'));
    }, CLONE_TIMEOUT_MS);
  });
}

export async function scanSkillsDir(baseDir: string): Promise<{ packages: SkillPackageInput[]; errors: string[] }> {
  const skillsDir = path.join(baseDir, 'skills');
  const packages: SkillPackageInput[] = [];
  const errors: string[] = [];
  const rootManifest = await fs.access(path.join(baseDir, 'SKILL.md')).then(() => true).catch(() => false);
  if (rootManifest) {
    try {
      packages.push(await loadSkillPackageDirectory(baseDir, { enforceDirectoryName: false }));
    } catch (error) {
      errors.push(`SKILL.md: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { packages, errors };
  }
  let scanDir: string;
  try {
    await fs.access(skillsDir);
    scanDir = skillsDir;
  } catch {
    scanDir = baseDir;
  }

  const entries = await fs.readdir(scanDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      packages.push(await loadSkillPackageDirectory(path.join(scanDir, entry.name)));
    } catch (error) {
      if (error instanceof SkillPackageError && error.reasonCode === 'skill_manifest_invalid') {
        const hasManifest = await fs.access(path.join(scanDir, entry.name, 'SKILL.md')).then(() => true).catch(() => false);
        if (!hasManifest) continue;
      }
      errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { packages, errors };
}

export async function importFromUrl(source: string): Promise<{ imported: string[]; errors: string[] }> {
  if (!isValidUrl(source)) throw new Error('Invalid URL');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-import-'));
  const imported: string[] = [];
  const errors: string[] = [];
  try {
    await cloneRepo(source, tmpDir);
    const scanned = await scanSkillsDir(tmpDir);
    errors.push(...scanned.errors);
    if (scanned.packages.length === 0) throw new Error(errors[0] ?? 'No skills found in repository');
    for (const skill of scanned.packages) {
      try {
        await skillRuntime.install(skill);
        imported.push(skill.name);
      } catch (error) {
        errors.push(`${skill.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return { imported, errors };
}
