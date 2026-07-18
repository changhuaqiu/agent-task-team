import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { SkillPackageFileInput, SkillPackageInput, SkillResourceKind } from '@/lib/skills/types';

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SkillPackageError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'SkillPackageError';
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkillMarkdown(raw: string): { name: string; description: string; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) {
    throw new SkillPackageError('skill_manifest_invalid', 'SKILL.md must contain YAML frontmatter');
  }

  const lines = match[1].split('\n');
  const values = new Map<string, string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const entry = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!entry) continue;
    const [, key, rawValue] = entry;
    if ((rawValue === '|' || rawValue === '>') && index + 1 < lines.length) {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        block.push(lines[index].trim());
      }
      values.set(key, rawValue === '>' ? block.join(' ') : block.join('\n'));
    } else {
      values.set(key, unquote(rawValue));
    }
  }

  const name = values.get('name')?.trim() ?? '';
  const description = values.get('description')?.trim() ?? '';
  if (!name || !description) {
    throw new SkillPackageError('skill_manifest_invalid', 'SKILL.md frontmatter requires non-empty name and description');
  }
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new SkillPackageError('skill_manifest_invalid', `Invalid skill name: ${name}`);
  }
  return { name, description, body: match[2].trim() };
}

export function normalizeSkillRelativePath(input: string): string {
  const normalized = input.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) {
    throw new SkillPackageError('skill_path_invalid', `Invalid skill file path: ${input}`);
  }
  const segments = normalized.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new SkillPackageError('skill_path_invalid', `Invalid skill file path: ${input}`);
  }
  return segments.join('/');
}

export function classifySkillResource(relativePath: string): SkillResourceKind {
  const normalized = normalizeSkillRelativePath(relativePath);
  if (normalized.startsWith('references/')) return 'reference';
  if (normalized.startsWith('scripts/')) return 'script';
  if (normalized.startsWith('assets/')) return 'asset';
  if (normalized.startsWith('agents/')) return 'agent_metadata';
  return 'other';
}

export function validateSkillPackage(input: SkillPackageInput): SkillPackageInput {
  const parsed = parseSkillMarkdown(input.skillMarkdown);
  if (parsed.name !== input.name || parsed.description !== input.description || parsed.body !== input.body.trim()) {
    throw new SkillPackageError('skill_manifest_invalid', 'Skill package metadata does not match SKILL.md');
  }
  const seen = new Set<string>();
  for (const file of input.files) {
    const relativePath = normalizeSkillRelativePath(file.path);
    if (relativePath.toLowerCase() === 'skill.md') {
      throw new SkillPackageError('skill_manifest_invalid', 'SKILL.md must not be duplicated in bundled files');
    }
    const portableKey = relativePath.normalize('NFC').toLocaleLowerCase('en-US');
    if (seen.has(portableKey)) {
      throw new SkillPackageError('skill_path_duplicate', `Duplicate skill file path: ${relativePath}`);
    }
    seen.add(portableKey);
  }
  return input;
}

function hashEntry(hash: crypto.Hash, relativePath: string, content: Uint8Array): void {
  hash.update(relativePath);
  hash.update('\0');
  hash.update(content);
  hash.update('\0');
}

export function computeSkillPackageHash(input: SkillPackageInput): string {
  validateSkillPackage(input);
  const hash = crypto.createHash('sha256');
  hashEntry(hash, 'SKILL.md', Buffer.from(input.skillMarkdown.replace(/\r\n/g, '\n'), 'utf8'));
  if (input.config !== undefined) {
    hashEntry(hash, '@config', Buffer.from(input.config, 'utf8'));
  }
  for (const file of [...input.files].sort((a, b) => a.path.localeCompare(b.path))) {
    hashEntry(hash, normalizeSkillRelativePath(file.path), file.content);
  }
  return hash.digest('hex');
}

async function walkPackageFiles(root: string, current = root): Promise<SkillPackageFileInput[]> {
  const output: SkillPackageFileInput[] = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new SkillPackageError('skill_path_invalid', `Symbolic links are not allowed: ${path.relative(root, absolute)}`);
    }
    if (entry.isDirectory()) {
      output.push(...await walkPackageFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = normalizeSkillRelativePath(path.relative(root, absolute));
    if (relativePath === 'SKILL.md') continue;
    output.push({ path: relativePath, content: await fs.readFile(absolute) });
  }
  return output;
}

export async function loadSkillPackageDirectory(
  skillDir: string,
  options: { enforceDirectoryName?: boolean } = { enforceDirectoryName: true },
): Promise<SkillPackageInput> {
  const stat = await fs.lstat(skillDir).catch(() => undefined);
  if (!stat?.isDirectory() || stat.isSymbolicLink()) {
    throw new SkillPackageError('skill_package_missing', `Skill directory not found: ${skillDir}`);
  }
  const skillMarkdownPath = path.join(skillDir, 'SKILL.md');
  const skillMarkdown = await fs.readFile(skillMarkdownPath, 'utf8').catch(() => {
    throw new SkillPackageError('skill_manifest_invalid', `Missing SKILL.md: ${skillDir}`);
  });
  const parsed = parseSkillMarkdown(skillMarkdown);
  if (options.enforceDirectoryName !== false && path.basename(skillDir) !== parsed.name) {
    throw new SkillPackageError('skill_manifest_invalid', `Skill directory ${path.basename(skillDir)} must match frontmatter name ${parsed.name}`);
  }
  return validateSkillPackage({
    ...parsed,
    skillMarkdown,
    files: await walkPackageFiles(skillDir),
  });
}

export async function computeInstalledPackageHash(packagePath: string, config?: string): Promise<string> {
  const installed = await loadSkillPackageDirectory(packagePath, { enforceDirectoryName: false });
  return computeSkillPackageHash({ ...installed, config });
}
