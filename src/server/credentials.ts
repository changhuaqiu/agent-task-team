import fs from 'node:fs';
import path from 'node:path';

export interface CredentialEntry {
  apiKey: string;
}

type CredentialMap = Record<string, CredentialEntry>;

function getDataDir(): string {
  return process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
}

function getCredentialsPath(): string {
  return path.join(getDataDir(), 'credentials.json');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpFile = path.join(dir, `credentials.json.tmp-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmpFile, data, 'utf-8');
  fs.renameSync(tmpFile, filePath);
  fs.chmodSync(filePath, 0o600);
}

function readAll(): CredentialMap {
  const filePath = getCredentialsPath();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(data: CredentialMap): void {
  atomicWrite(getCredentialsPath(), JSON.stringify(data, null, 2));
}

export function readCredential(id: string): CredentialEntry | null {
  const all = readAll();
  return all[id] ?? null;
}

export function writeCredential(id: string, entry: CredentialEntry): void {
  let all: CredentialMap;
  try {
    all = readAll();
  } catch {
    all = {};
  }
  all[id] = entry;
  writeAll(all);
}

export function deleteCredential(id: string): void {
  let all: CredentialMap;
  try {
    all = readAll();
  } catch {
    return;
  }
  if (!(id in all)) return;
  delete all[id];
  writeAll(all);
}

export function hasCredential(id: string): boolean {
  const all = readAll();
  return id in all;
}

export function listCredentialIds(): string[] {
  return Object.keys(readAll());
}
