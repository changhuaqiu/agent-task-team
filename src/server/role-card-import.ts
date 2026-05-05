// src/server/role-card-import.ts

import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { upsertRoleCard } from './db/roleCardQueries';
import { securityScanner } from './security-scanner';
import type { RoleCard, RoleCardCategory } from '@/types/roleCard';

interface SoulSpecMetadata {
  specVersion: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  author?: { name: string; github?: string };
  license?: string;
  tags?: string[];
  category?: string;
  files?: { soul?: string; identity?: string; agents?: string };
}

interface ParsedSoul {
  metadata: SoulSpecMetadata;
  soulContent: string;
  identityContent?: string;
  agentsContent?: string;
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

const CLONE_TIMEOUT_MS = 30_000;

function classifyCloneError(err: Error): Error {
  const msg = err.message.toLowerCase();
  if (msg.includes('timed out') || msg.includes('timeout')) {
    return new Error('网络连接失败，请检查网络连接或代理设置。');
  }
  if (msg.includes('not found') || msg.includes('404')) {
    return new Error('仓库不存在，请检查 URL 是否正确。');
  }
  if (msg.includes('authentication') || msg.includes('403')) {
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
    setTimeout(() => {
      child.kill();
      reject(new Error('克隆超时（30秒），请检查网络连接。'));
    }, CLONE_TIMEOUT_MS);
  });
}

async function parseSoulSpec(dirPath: string): Promise<ParsedSoul | null> {
  const soulJsonPath = path.join(dirPath, 'soul.json');
  let metadata: SoulSpecMetadata;

  try {
    const raw = await fs.readFile(soulJsonPath, 'utf-8');
    metadata = JSON.parse(raw);
  } catch {
    return parseRawSoulMd(dirPath);
  }

  const soulPath = path.join(dirPath, metadata.files?.soul ?? 'SOUL.md');
  let soulContent: string;
  try {
    soulContent = await fs.readFile(soulPath, 'utf-8');
  } catch {
    return null;
  }

  let identityContent: string | undefined;
  let agentsContent: string | undefined;

  if (metadata.files?.identity) {
    try { identityContent = await fs.readFile(path.join(dirPath, metadata.files.identity), 'utf-8'); } catch {}
  }
  if (metadata.files?.agents) {
    try { agentsContent = await fs.readFile(path.join(dirPath, metadata.files.agents), 'utf-8'); } catch {}
  }

  return { metadata, soulContent, identityContent, agentsContent };
}

async function parseRawSoulMd(dirPath: string): Promise<ParsedSoul | null> {
  const soulPath = path.join(dirPath, 'SOUL.md');
  let soulContent: string;

  try {
    soulContent = await fs.readFile(soulPath, 'utf-8');
  } catch {
    return null;
  }

  const nameMatch = soulContent.match(/^#\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : path.basename(dirPath);

  return {
    metadata: {
      specVersion: 'raw',
      name: name.toLowerCase().replace(/\s+/g, '-'),
      displayName: name,
      version: '1.0.0',
      description: '',
    },
    soulContent,
  };
}

function soulToRoleCard(parsed: ParsedSoul): RoleCard {
  const { metadata, soulContent } = parsed;
  const now = new Date().toISOString();

  const personaMatch = soulContent.match(/##\s*(?:Personality|Persona|Vibe|核心身份)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const persona = personaMatch ? personaMatch[1].trim() : '';

  const principlesMatch = soulContent.match(/##\s*(?:Principles|Core Truths|核心原则)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const principles = principlesMatch
    ? principlesMatch[1].split('\n').filter(l => l.startsWith('-')).map(l => l.slice(1).trim())
    : [];

  const boundariesMatch = soulContent.match(/##\s*(?:Boundaries|Limits|边界)\s*\n([\s\S]*?)(?=\n##|$)/i);
  const boundaries = boundariesMatch
    ? boundariesMatch[1].split('\n').filter(l => l.startsWith('-')).map(l => l.slice(1).trim())
    : [];

  const categoryMap: Record<string, RoleCardCategory> = {
    'work/engineering': 'backend',
    'work/frontend': 'frontend',
    'work/devops': 'backend',
    'work/qa': 'qa',
    'work/planning': 'planner',
    'work/review': 'code_reviewer',
  };

  return {
    id: `imported-${metadata.name}`,
    name: metadata.name,
    displayName: metadata.displayName,
    description: metadata.description,
    category: categoryMap[metadata.category ?? ''] ?? 'backend',
    tags: metadata.tags ?? [],
    applicableScenarios: [],
    responsibilities: principles.slice(0, 5),
    nonResponsibilities: boundaries,
    successCriteria: [],
    clarifyBeforeExecute: 'when_ambiguous',
    outputStyle: 'concise',
    preferStructuredOutput: false,
    allowedActions: [],
    requiresConfirmation: [],
    forbiddenActions: [],
    preferredEngines: [],
    allowedTools: [],
    accountIds: [],
    outputFormat: 'freeform',
    requiresEvidence: false,
    riskGrading: 'none',
    persona: {
      introduction: persona.slice(0, 500),
      voice: '',
      mindset: '',
      habits: '',
      collaboration: '',
    },
    isPreset: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export async function importRoleCardFromUrl(source: string): Promise<{ imported: string[]; errors: string[] }> {
  if (!isValidUrl(source)) throw new Error('Invalid URL');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'role-card-import-'));
  const imported: string[] = [];
  const errors: string[] = [];

  try {
    await cloneRepo(source, tmpDir);

    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    const soulDirs: string[] = [];

    const hasSoulJson = entries.some(e => e.isFile() && e.name === 'soul.json');
    const hasSoulMd = entries.some(e => e.isFile() && e.name === 'SOUL.md');

    if (hasSoulJson || hasSoulMd) {
      soulDirs.push(tmpDir);
    } else {
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const subDir = path.join(tmpDir, entry.name);
        const subEntries = await fs.readdir(subDir);
        if (subEntries.includes('soul.json') || subEntries.includes('SOUL.md')) {
          soulDirs.push(subDir);
        }
      }
    }

    if (soulDirs.length === 0) {
      throw new Error('未找到 soul.json 或 SOUL.md 文件');
    }

    for (const dir of soulDirs) {
      try {
        const parsed = await parseSoulSpec(dir);
        if (!parsed) {
          errors.push(`${path.basename(dir)}: 无法解析`);
          continue;
        }

        // Security scan before upserting to database
        const scanResult = securityScanner.scan(parsed.soulContent);
        if (!scanResult.passed) {
          errors.push(`${path.basename(dir)}: 安全扫描未通过`);
          errors.push(...scanResult.critical);
          errors.push(...scanResult.warnings.map(w => `  - ${w}`));
          continue;
        }

        const roleCard = soulToRoleCard(parsed);
        upsertRoleCard(roleCard);
        imported.push(roleCard.name);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        errors.push(`${path.basename(dir)}: ${message}`);
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  return { imported, errors };
}
