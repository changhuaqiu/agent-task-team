import fs from 'node:fs';
import path from 'node:path';

export interface AccountMeta {
  id: string;
  name: string;
  authMode: 'api_key' | 'oauth';
  provider: 'anthropic' | 'openai' | 'google' | 'kimi' | 'opencode' | 'other';
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  status: 'unknown' | 'valid' | 'pending' | 'error';
  lastVerifiedAt?: string;
  verifyError?: string;
  createdAt: string;
  updatedAt: string;
}

type AccountMap = Record<string, AccountMeta>;

function getDataDir(): string {
  return process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
}

function getAccountsPath(): string {
  return path.join(getDataDir(), 'accounts.json');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpFile = path.join(dir, `accounts.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpFile, data, 'utf-8');
  fs.renameSync(tmpFile, filePath);
}

function readAll(): AccountMap {
  const filePath = getAccountsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(data: AccountMap): void {
  atomicWrite(getAccountsPath(), JSON.stringify(data, null, 2));
}

function backupCorrupt(): void {
  const filePath = getAccountsPath();
  try {
    fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    JSON.parse(raw);
  } catch {
    fs.copyFileSync(filePath, filePath + '.bak');
  }
}

export function readAccount(id: string): AccountMeta | undefined {
  const all = readAll();
  return all[id];
}

export function writeAccount(meta: AccountMeta): void {
  backupCorrupt();

  let all: AccountMap;
  try {
    all = readAll();
  } catch {
    all = {};
  }

  const existing = all[meta.id];
  const now = new Date().toISOString();

  if (existing && existing.createdAt) {
    meta.createdAt = existing.createdAt;
  } else if (!meta.createdAt) {
    meta.createdAt = now;
  }

  if (!meta.updatedAt) {
    meta.updatedAt = now;
  }

  all[meta.id] = meta;
  writeAll(all);
}

export function deleteAccount(id: string): void {
  let all: AccountMap;
  try {
    all = readAll();
  } catch {
    return;
  }
  if (!(id in all)) return;
  delete all[id];
  writeAll(all);
}

export function listAccounts(): AccountMeta[] {
  return Object.values(readAll());
}

export function hasAccount(id: string): boolean {
  const all = readAll();
  return id in all;
}
