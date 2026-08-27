import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { loadCatalog, resolveCatalogLauncher, type AgentCatalogEntry } from './catalog';

const execFileAsync = promisify(execFile);
const CACHE_MS = 15_000;

export interface AcpRuntimeDiscoveryItem {
  id: AgentCatalogEntry['id'];
  label: string;
  delivery: AgentCatalogEntry['delivery'];
  available: boolean;
  executablePath?: string;
  capabilities: string[];
  status: 'ready' | 'needs_setup';
  custom?: boolean;
}

let sharedResult: { expiresAt: number; items: AcpRuntimeDiscoveryItem[] } | undefined;
let discoveryInFlight: Promise<AcpRuntimeDiscoveryItem[]> | undefined;

const LABELS: Record<string, string> = {
  goose: 'Goose',
  claude: 'Claude',
  codex: 'Codex',
  'buzz-agent': 'Buzz Agent',
  devin: 'Devin',
  cursor: 'Cursor',
  omp: 'Oh My Pi',
  grok: 'Grok Build',
  opencode: 'OpenCode',
  kimi: 'Kimi Code',
  amp: 'Amp',
  hermes: 'Hermes Agent',
  openclaw: 'OpenClaw',
};

function runtimeLabel(entry: AgentCatalogEntry): string {
  const info = entry.agentInfo;
  if (info && typeof info === 'object') {
    const title = (info as Record<string, unknown>).title;
    const name = (info as Record<string, unknown>).name;
    if (typeof title === 'string' && title.trim()) return title.trim();
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return LABELS[entry.id] ?? entry.id.replace(/^custom:/, '');
}

async function resolveExecutable(command: string): Promise<string | undefined> {
  if (isAbsolute(command)) return existsSync(command) ? command : undefined;
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const { stdout } = await execFileAsync(lookup, [command], {
      timeout: 3_000,
      windowsHide: true,
    });
    return stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
  } catch {
    return undefined;
  }
}

async function discover(): Promise<AcpRuntimeDiscoveryItem[]> {
  return Promise.all(loadCatalog().map(async (entry) => {
    const launcher = resolveCatalogLauncher(entry);
    const executablePath = await resolveExecutable(launcher.command);
    return {
      id: entry.id,
      label: runtimeLabel(entry),
      delivery: entry.delivery,
      available: Boolean(executablePath),
      executablePath,
      capabilities: [...entry.verifiedCapabilities],
      status: executablePath ? 'ready' : 'needs_setup',
      custom: entry.custom === true,
    };
  }));
}

export async function discoverAcpRuntimes(options?: { force?: boolean }): Promise<AcpRuntimeDiscoveryItem[]> {
  const now = Date.now();
  if (!options?.force && sharedResult && sharedResult.expiresAt > now) return sharedResult.items;
  if (discoveryInFlight) return discoveryInFlight;

  discoveryInFlight = discover()
    .then((items) => {
      sharedResult = { items, expiresAt: Date.now() + CACHE_MS };
      return items;
    })
    .finally(() => {
      discoveryInFlight = undefined;
    });
  return discoveryInFlight;
}
