import fs from 'node:fs';
import path from 'node:path';
import type { AgentCatalogEntry } from './catalog';

export interface CustomAcpHarnessInput {
  id: string;
  label: string;
  command: string;
  args?: string[];
  /** Secret and environment values belong to Account/Credential storage. */
  env?: Record<string, never>;
}

interface StoredCustomAcpHarness {
  id: `custom:${string}`;
  label: string;
  command: string;
  args: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;
const SECRET_ARG_NAME_PATTERN = /(?:^|[-_])(?:api[-_]?key|access[-_]?token|client[-_]?secret|private[-_]?key|credential|authorization|auth|bearer|password|passwd|pass|secret|token|key)(?:$|[-_=:]|\s)/i;
const SECRET_ARG_VALUE_PATTERN = /^(?:sk-|pk-|rk-|ghp_|github_pat_|xox[aboprs]-|eyJ[A-Za-z0-9_-]{8,}\.)/i;
const SECRET_HEADER_PATTERN = /(?:--header=|-H)\s*(?:authorization|x[-_]?api[-_]?key|api[-_]?key|access[-_]?token|credential|private[-_]?key)\s*:/i;

function hasSecretArgument(args: string[]): boolean {
  return args.some((arg) => SECRET_ARG_NAME_PATTERN.test(arg)
    || SECRET_ARG_VALUE_PATTERN.test(arg.trim())
    || SECRET_HEADER_PATTERN.test(arg));
}

function catalogPath() {
  const dataDir = process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
  return path.join(dataDir, 'custom-acp-runtimes.json');
}

function readStored(): StoredCustomAcpHarness[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(catalogPath(), 'utf-8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is StoredCustomAcpHarness => Boolean(
      item && typeof item === 'object'
      && typeof (item as StoredCustomAcpHarness).id === 'string'
      && typeof (item as StoredCustomAcpHarness).label === 'string'
      && typeof (item as StoredCustomAcpHarness).command === 'string'
      && Array.isArray((item as StoredCustomAcpHarness).args),
    )).flatMap((item) => {
      try {
        const normalized = normalizeInput({
          id: item.id,
          label: item.label,
          command: item.command,
          args: item.args,
        });
        return normalized.id === item.id ? [normalized] : [];
      } catch {
        // Stored launchers remain untrusted input. Revalidate on every read so
        // entries written by older versions cannot bypass current policy.
        return [];
      }
    });
  } catch {
    return [];
  }
}

function writeStored(items: StoredCustomAcpHarness[]) {
  const filePath = catalogPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `custom-acp-runtimes.tmp-${process.pid}-${Date.now()}.json`);
  fs.writeFileSync(tempPath, `${JSON.stringify(items, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function normalizeInput(input: CustomAcpHarnessInput): StoredCustomAcpHarness {
  const rawId = input.id.trim().replace(/^custom:/, '');
  const label = input.label.trim();
  const command = input.command.trim();
  const args = input.args ?? [];
  if (!ID_PATTERN.test(rawId)) throw new Error('custom_runtime_id_invalid');
  if (!label || label.length > 80) throw new Error('custom_runtime_label_invalid');
  if (!command || command.length > 512 || /[\r\n\0]/.test(command)) throw new Error('custom_runtime_command_invalid');
  if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string' || arg.length > 2_048 || /[\r\n\0]/.test(arg))) {
    throw new Error('custom_runtime_args_invalid');
  }
  if (hasSecretArgument(args)) {
    throw new Error('custom_runtime_secret_arg_invalid');
  }
  if (input.env && Object.keys(input.env).length > 0) {
    throw new Error('custom_runtime_env_invalid');
  }
  return { id: `custom:${rawId}`, label, command, args: [...args] };
}

export function listCustomAcpHarnesses(): AgentCatalogEntry[] {
  return readStored().map((item) => ({
    id: item.id,
    protocol: 'acp',
    delivery: 'native',
    launcher: { command: item.command, args: [...item.args] },
    verifiedCapabilities: [],
    agentInfo: { title: item.label, name: item.label },
    custom: true,
  }));
}

export function saveCustomAcpHarness(input: CustomAcpHarnessInput): AgentCatalogEntry {
  const normalized = normalizeInput(input);
  const items = readStored();
  const next = [...items.filter((item) => item.id !== normalized.id), normalized];
  writeStored(next);
  return listCustomAcpHarnesses().find((item) => item.id === normalized.id)!;
}

export function deleteCustomAcpHarness(id: string): boolean {
  const normalizedId = id.startsWith('custom:') ? id : `custom:${id}`;
  const items = readStored();
  const next = items.filter((item) => item.id !== normalizedId);
  if (next.length === items.length) return false;
  writeStored(next);
  return true;
}
