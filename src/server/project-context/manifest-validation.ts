import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  PROJECT_CONTEXT_GENERATOR,
  PROJECT_CONTEXT_MANIFEST_CHECKPOINT_FILE,
  PROJECT_CONTEXT_OWNER_FILE,
  PROJECT_CONTEXT_SCHEMA_VERSION,
  ProjectContextError,
  type ProjectContextManifest,
  type ProjectContextManifestCheckpoint,
} from './types';

type UnknownRecord = Record<string, unknown>;

const LAYER_IDS = new Set([
  'scope',
  'norms-constraints',
  'topology',
  'development',
  'work',
  'knowledge',
]);
const FRESHNESS_VALUES = new Set(['stable', 'structural', 'volatile']);
const KNOWLEDGE_LAYERS = new Set(['norms-constraints', 'topology', 'development', 'knowledge']);

function unreadable(message = '项目上下文 manifest 无效，请刷新后重试'): never {
  throw new ProjectContextError('project_context_unreadable', message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function canonicalIdentity(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function digestProjectContextManifest(manifest: ProjectContextManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export async function readProjectContextCheckpointSignature(
  root: string,
): Promise<{ signature?: string; checks: number }> {
  const targets = [
    path.join(root, '.ath', 'context', PROJECT_CONTEXT_OWNER_FILE),
    path.join(root, '.ath', 'context', 'manifest.json'),
    path.join(root, '.ath', 'context', PROJECT_CONTEXT_MANIFEST_CHECKPOINT_FILE),
  ];
  try {
    const metadata = await Promise.all(targets.map(target => lstat(target)));
    if (metadata.some(entry => !entry.isFile() || entry.isSymbolicLink())) {
      return { checks: targets.length };
    }
    return {
      checks: targets.length,
      signature: metadata.map(entry => (
        `${entry.dev}:${entry.ino}:${Number(entry.ctimeMs.toFixed(3))}`
        + `:${Number(entry.mtimeMs.toFixed(3))}:${entry.size}`
      )).join(':'),
    };
  } catch {
    return { checks: targets.length };
  }
}

export function createManifestIntegrityCheckpoint(
  root: string,
  manifest: ProjectContextManifest,
): ProjectContextManifestCheckpoint {
  return {
    schemaVersion: PROJECT_CONTEXT_SCHEMA_VERSION,
    generator: PROJECT_CONTEXT_GENERATOR,
    root: path.resolve(root),
    revision: manifest.revision,
    manifestDigest: digestProjectContextManifest(manifest),
    publishedAt: new Date().toISOString(),
  };
}

export function validateManifestIntegrityCheckpoint(
  root: string,
  manifest: ProjectContextManifest,
  value: unknown,
): ProjectContextManifestCheckpoint {
  if (
    !isRecord(value)
    || value.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION
    || value.generator !== PROJECT_CONTEXT_GENERATOR
    || !isNonEmptyString(value.root)
    || canonicalIdentity(value.root) !== canonicalIdentity(root)
    || value.revision !== manifest.revision
    || !/^[a-f0-9]{64}$/.test(String(value.manifestDigest ?? ''))
    || value.manifestDigest !== digestProjectContextManifest(manifest)
    || !isNonEmptyString(value.publishedAt)
  ) {
    unreadable('项目上下文 manifest integrity checkpoint 缺失或不一致，请显式刷新');
  }
  return value as unknown as ProjectContextManifestCheckpoint;
}

export function resolveProjectManifestPath(
  root: string,
  value: unknown,
  options: { allowRoot?: boolean } = {},
): string {
  if (
    !isNonEmptyString(value)
    || value !== value.trim()
    || value.includes('\\')
    || /[\u0000-\u001f\u007f]/.test(value)
    || path.posix.isAbsolute(value)
    || path.win32.isAbsolute(value)
    || /^[A-Za-z]:/.test(value)
  ) {
    unreadable('项目上下文 manifest 包含不安全路径，请显式刷新');
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === '..'
    || normalized.startsWith('../')
    || (!options.allowRoot && normalized === '.')
  ) {
    unreadable('项目上下文 manifest 包含非规范化或越界路径，请显式刷新');
  }
  const resolvedRoot = path.resolve(root);
  const target = normalized === '.'
    ? resolvedRoot
    : path.resolve(resolvedRoot, ...normalized.split('/'));
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    unreadable('项目上下文 manifest 路径超出项目根，请显式刷新');
  }
  return target;
}

export async function assertManifestPathHasNoLinkedAncestor(
  root: string,
  relativePath: string,
  checkedDirectories: Set<string>,
): Promise<void> {
  if (relativePath === '.') return;
  let current = path.resolve(root);
  const segments = relativePath.split('/');
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    const identity = canonicalIdentity(current);
    if (checkedDirectories.has(identity)) continue;
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        unreadable('项目上下文 manifest 路径包含链接或非目录祖先，请显式刷新');
      }
      checkedDirectories.add(identity);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      if (error instanceof ProjectContextError) throw error;
      unreadable('无法验证项目上下文 manifest 路径，请显式刷新');
    }
  }
}

export function validateProjectContextManifest(
  value: unknown,
  expectedRoot: string,
): ProjectContextManifest {
  if (!isRecord(value) || typeof value.schemaVersion !== 'number') unreadable();
  if (value.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION) {
    throw new ProjectContextError(
      'project_context_schema_unsupported',
      `项目上下文版本 ${value.schemaVersion} 暂不支持，请显式刷新`,
    );
  }
  if (
    !Number.isInteger(value.revision)
    || Number(value.revision) < 1
    || !isNonEmptyString(value.generatedAt)
    || !/^[a-f0-9]{64}$/.test(String(value.sourceFingerprint ?? ''))
    || !isRecord(value.project)
    || !isNonEmptyString(value.project.root)
    || canonicalIdentity(value.project.root) !== canonicalIdentity(expectedRoot)
    || !isNonEmptyString(value.project.name)
    || !['codebase', 'empty'].includes(String(value.project.kind))
    || !isStringArray(value.project.technologies)
    || (value.project.packageManager !== undefined && typeof value.project.packageManager !== 'string')
    || !Array.isArray(value.layers)
    || !Array.isArray(value.instructions)
    || !Array.isArray(value.commands)
    || !isRecord(value.topology)
    || value.topology.path !== '.ath/context/topology.json'
    || !isNonNegativeInteger(value.topology.moduleCount)
    || !isNonNegativeInteger(value.topology.edgeCount)
    || value.topology.precision !== 'heuristic'
    || !/^[a-f0-9]{64}$/.test(String(value.topology.digest ?? ''))
    || !Array.isArray(value.knowledge)
    || !Array.isArray(value.freshnessInputs)
    || !isRecord(value.diagnostics)
    || !['complete', 'incomplete'].includes(String(value.diagnostics.freshnessCoverage))
  ) {
    unreadable('项目上下文 manifest 缺少必要字段，请显式刷新');
  }

  const diagnostics = value.diagnostics;
  const integerDiagnostics = [
    'entriesVisited',
    'filesRead',
    'bytesRead',
    'indexedDocuments',
    'indexedModules',
    'selectedKnowledgeCount',
    'freshnessChecks',
  ];
  if (
    typeof diagnostics.cacheHit !== 'boolean'
    || typeof diagnostics.truncated !== 'boolean'
    || !integerDiagnostics.every(key => isNonNegativeInteger(diagnostics[key]))
    || !isNonNegativeNumber(diagnostics.durationMs)
  ) unreadable('项目上下文 manifest diagnostics 无效，请显式刷新');

  if (!value.layers.every((layer) => (
    isRecord(layer)
    && LAYER_IDS.has(String(layer.id))
    && isStringArray(layer.sources)
    && FRESHNESS_VALUES.has(String(layer.freshness))
  ))) unreadable('项目上下文 manifest layers 无效，请显式刷新');

  const freshnessFilePaths = new Set<string>();
  for (const input of value.freshnessInputs) {
    if (
      !isRecord(input)
      || !['file', 'directory'].includes(String(input.kind))
      || !isNonNegativeNumber(input.mtimeMs)
      || !isNonNegativeNumber(input.size)
    ) unreadable('项目上下文 manifest freshness input 无效，请显式刷新');
    resolveProjectManifestPath(expectedRoot, input.path, { allowRoot: true });
    if (input.kind === 'file') freshnessFilePaths.add(String(input.path));
  }

  const instructionPaths = new Set<string>();
  for (const instruction of value.instructions) {
    if (
      !isRecord(instruction)
      || !isNonEmptyString(instruction.title)
      || typeof instruction.appliesTo !== 'string'
      || !isNonNegativeNumber(instruction.priority)
      || instruction.authority !== 'explicit'
      || !['instruction', 'standard', 'active-spec'].includes(String(instruction.kind))
    ) unreadable('项目上下文 manifest instruction 无效，请显式刷新');
    resolveProjectManifestPath(expectedRoot, instruction.path);
    const instructionPath = String(instruction.path);
    instructionPaths.add(instructionPath);
    if (!freshnessFilePaths.has(instructionPath)) {
      unreadable('项目上下文 instruction 缺少 owner freshness source，请显式刷新');
    }
  }

  for (const command of value.commands) {
    if (
      !isRecord(command)
      || !isNonEmptyString(command.name)
      || !isNonEmptyString(command.command)
      || command.authority !== 'explicit'
    ) unreadable('项目上下文 manifest command 无效，请显式刷新');
    resolveProjectManifestPath(expectedRoot, command.source);
    if (!freshnessFilePaths.has(String(command.source))) {
      unreadable('项目上下文 command 缺少 owner freshness source，请显式刷新');
    }
  }

  const knowledgePaths = new Set<string>();
  for (const entry of value.knowledge) {
    if (
      !isRecord(entry)
      || !/^[a-f0-9]{16}$/.test(String(entry.id ?? ''))
      || !KNOWLEDGE_LAYERS.has(String(entry.layer))
      || !isNonEmptyString(entry.title)
      || typeof entry.summary !== 'string'
      || !isStringArray(entry.tags)
      || !['explicit', 'inferred'].includes(String(entry.authority))
      || !FRESHNESS_VALUES.has(String(entry.freshness))
      || !isNonNegativeNumber(entry.priority)
    ) unreadable('项目上下文 manifest knowledge entry 无效，请显式刷新');
    resolveProjectManifestPath(expectedRoot, entry.path);
    const knowledgePath = String(entry.path);
    knowledgePaths.add(knowledgePath);
    if (!freshnessFilePaths.has(knowledgePath)) {
      unreadable('项目上下文 knowledge 缺少 owner freshness source，请显式刷新');
    }
  }
  for (const instructionPath of instructionPaths) {
    if (!knowledgePaths.has(instructionPath)) {
      unreadable('项目上下文 instruction 缺少对应 owner knowledge entry，请显式刷新');
    }
  }

  return value as unknown as ProjectContextManifest;
}

export async function validateManifestOwnerSources(
  root: string,
  manifest: ProjectContextManifest,
): Promise<void> {
  const checkedDirectories = new Set<string>();
  const ownerPaths = new Set([
    ...manifest.instructions.map(entry => entry.path),
    ...manifest.knowledge.map(entry => entry.path),
    ...manifest.commands.map(entry => entry.source),
  ]);
  const rootRealPath = await realpath(root);
  for (const relativePath of ownerPaths) {
    const target = resolveProjectManifestPath(root, relativePath);
    await assertManifestPathHasNoLinkedAncestor(root, relativePath, checkedDirectories);
    try {
      const metadata = await lstat(target);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        unreadable('项目上下文 owner source 不是普通文件，请显式刷新');
      }
      const targetRealPath = await realpath(target);
      const relative = path.relative(rootRealPath, targetRealPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        unreadable('项目上下文 owner source 真实路径超出项目根，请显式刷新');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      if (error instanceof ProjectContextError) throw error;
      unreadable('无法验证项目上下文 owner source，请显式刷新');
    }
  }
}
