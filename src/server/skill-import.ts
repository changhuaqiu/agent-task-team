import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { skillRepo } from './repositories/skill-repo';

interface ParsedSkill {
  name: string;
  description: string;
  content: string;
  files: { path: string; content: string }[];
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) meta[key.trim()] = rest.join(':').trim();
  }
  return { meta, body: match[2] };
}

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
      if (err) reject(classifyCloneError(err));
      else resolve();
    });
    // Kill the process if it takes too long
    setTimeout(() => {
      child.kill();
      reject(new Error('克隆超时（30秒），请检查网络连接。'));
    }, CLONE_TIMEOUT_MS);
  });
}

async function scanSkillsDir(baseDir: string): Promise<ParsedSkill[]> {
  const skillsDir = path.join(baseDir, 'skills');
  const skills: ParsedSkill[] = [];
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
    const skillFilePath = path.join(scanDir, entry.name, 'SKILL.md');
    try {
      const raw = await fs.readFile(skillFilePath, 'utf-8');
      const { meta, body } = parseFrontmatter(raw);
      const files: { path: string; content: string }[] = [];
      const skillDir = path.join(scanDir, entry.name);
      const fileEntries = await fs.readdir(skillDir, { withFileTypes: true, recursive: true });
      for (const fe of fileEntries) {
        if (!fe.isFile() || fe.name === 'SKILL.md') continue;
        // Build relative path
        const fePath = path.join(fe.parentPath ?? (fe as any).path ?? '', fe.name);
        const relativePath = path.relative(skillDir, fePath);
        if (relativePath.includes('..')) continue;
        const fileContent = await fs.readFile(fePath, 'utf-8');
        files.push({ path: relativePath, content: fileContent });
      }
      skills.push({ name: meta.name || entry.name, description: meta.description || '', content: body.trim(), files });
    } catch {
      // Skip directories without SKILL.md
    }
  }
  return skills;
}

export async function importFromUrl(source: string): Promise<{ imported: string[]; errors: string[] }> {
  if (!isValidUrl(source)) throw new Error('Invalid URL');
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-import-'));
  const imported: string[] = [];
  const errors: string[] = [];
  try {
    await cloneRepo(source, tmpDir);
    const parsed = await scanSkillsDir(tmpDir);
    if (parsed.length === 0) throw new Error('No skills found in repository');
    for (const skill of parsed) {
      try {
        const existing = skillRepo.getByName(skill.name);
        if (existing) {
          skillRepo.update(existing.id, { description: skill.description, content: skill.content });
          skillRepo.replaceFiles(existing.id, skill.files);
        } else {
          const created = skillRepo.create({ name: skill.name, description: skill.description, content: skill.content });
          for (const f of skill.files) {
            skillRepo.addFile(created.id, f);
          }
        }
        imported.push(skill.name);
      } catch (e: any) {
        errors.push(`${skill.name}: ${e.message}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
  return { imported, errors };
}
