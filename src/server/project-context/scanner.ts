import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  open,
  readdir,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { buildCodeTopology, isSourceFile, type TopologySource } from './topology';
import {
  assertManifestPathHasNoLinkedAncestor,
  readProjectContextCheckpointSignature,
  resolveProjectManifestPath,
  validateManifestOwnerSources,
  validateManifestIntegrityCheckpoint,
  validateProjectContextManifest,
} from './manifest-validation';
import {
  PROJECT_CONTEXT_GENERATOR,
  PROJECT_CONTEXT_MANIFEST_CHECKPOINT_FILE,
  PROJECT_CONTEXT_OWNER_FILE,
  PROJECT_CONTEXT_SCHEMA_VERSION,
  ProjectContextError,
  type CodeTopology,
  type ProjectCommandEntry,
  type ProjectContextInspection,
  type ProjectFreshnessInput,
  type ProjectInstructionEntry,
  type ProjectKnowledgeEntry,
  type ProjectScanDiagnostics,
} from './types';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.ath', 'node_modules', '.next', 'dist', 'build', 'out', 'coverage',
  'target', 'vendor', '.venv', 'venv', '__pycache__', '.cache', '.turbo',
  '.pnpm-store', '.idea', '.vscode',
]);

const ROOT_MARKERS = new Set([
  'package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'cargo.toml',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'gemfile',
  'mix.exs', 'pubspec.yaml',
]);

const DOCUMENT_EXTENSIONS = new Set(['.md', '.mdx', '.rst', '.txt']);
const SECRET_FILE_PATTERNS = [
  /^\.env(?:\.|$)/i,
  /\.(?:pem|key|p12|pfx|jks)$/i,
  /(?:^|[-_.])credentials?(?:[-_.]|$)/i,
  /(?:^|[-_.])secrets?(?:[-_.]|$)/i,
];

const MAX_DEPTH = 7;
const MAX_ENTRIES = 5_000;
const MAX_DOCUMENTS = 100;
const MAX_MODULES = 900;
const MAX_READ_BYTES = 24_000;
const MAX_FRESHNESS_INPUTS = 1_600;

export interface ScanOutput {
  projectName: string;
  projectKind: 'codebase' | 'empty';
  technologies: string[];
  packageManager?: string;
  instructions: ProjectInstructionEntry[];
  commands: ProjectCommandEntry[];
  knowledge: ProjectKnowledgeEntry[];
  topology: CodeTopology;
  freshnessInputs: ProjectFreshnessInput[];
  sourceFingerprint: string;
  diagnostics: ProjectScanDiagnostics;
}

function normalizeRelative(value: string): string {
  const normalized = value.replaceAll('\\', '/').replace(/^\.\//, '');
  return normalized || '.';
}

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name.toLowerCase());
}

function isSensitiveFile(filePath: string): boolean {
  const basename = path.basename(filePath);
  return SECRET_FILE_PATTERNS.some(pattern => pattern.test(basename));
}

function hasRootMarker(names: string[]): boolean {
  return names.some(name => {
    const lower = name.toLowerCase();
    return (
      ROOT_MARKERS.has(lower)
      || lower === '.git'
      || lower.endsWith('.sln')
      || lower.endsWith('.csproj')
    );
  });
}

async function validateDirectory(projectPath: string): Promise<string> {
  if (!projectPath?.trim()) {
    throw new ProjectContextError('project_path_missing', '请选择代码项目目录');
  }
  const resolved = path.resolve(projectPath);
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectContextError('project_path_not_found', `项目目录不存在：${resolved}`);
    }
    throw new ProjectContextError('project_context_unreadable', `无法读取项目目录：${resolved}`);
  }
  if (!metadata.isDirectory()) {
    throw new ProjectContextError('project_path_not_directory', `所选路径不是目录：${resolved}`);
  }
  return resolved;
}

async function readFileNoFollow(
  target: string,
  expectedRootRealPath?: string,
): Promise<Buffer> {
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new ProjectContextError(
      'project_context_unreadable',
      `拒绝读取符号链接或非普通文件：${target}`,
    );
  }
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (expectedRootRealPath) {
      const parentRealPath = await realpath(path.dirname(target));
      const relativeParent = path.relative(expectedRootRealPath, parentRealPath);
      if (relativeParent.startsWith('..') || path.isAbsolute(relativeParent)) {
        throw new ProjectContextError(
          'project_context_unreadable',
          `拒绝读取项目根之外的文件：${target}`,
        );
      }
    }
    const after = await lstat(target);
    if (
      after.isSymbolicLink()
      || !after.isFile()
      || (opened.ino !== 0 && after.ino !== 0 && opened.ino !== after.ino)
      || (opened.dev !== 0 && after.dev !== 0 && opened.dev !== after.dev)
    ) {
      throw new ProjectContextError(
        'project_context_unreadable',
        `读取期间文件身份发生变化：${target}`,
      );
    }
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function readDirectoryNames(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true })).map(entry => entry.name);
  } catch {
    throw new ProjectContextError('project_context_unreadable', `无法读取项目目录：${directory}`);
  }
}

async function discoverCandidateRoots(
  selectedRoot: string,
  maxDepth: number,
): Promise<{ candidates: string[]; entriesVisited: number; hasSource: boolean; hasContent: boolean }> {
  const candidates: string[] = [];
  let entriesVisited = 0;
  let hasSource = false;
  let hasContent = false;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth || entriesVisited >= MAX_ENTRIES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entriesVisited += entries.length;
    const visible = entries.filter(entry => (
      entry.name !== '.ath' && entry.name !== '.DS_Store' && entry.name !== 'Thumbs.db'
    ));
    if (visible.length > 0) hasContent = true;
    if (directory !== selectedRoot && hasRootMarker(entries.map(entry => entry.name))) {
      candidates.push(directory);
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && isSourceFile(entry.name)) hasSource = true;
      if (
        entry.isDirectory()
        && !isIgnoredDirectory(entry.name)
        && depth < maxDepth
      ) {
        await visit(path.join(directory, entry.name), depth + 1);
      }
    }
  }

  await visit(selectedRoot, 0);
  return {
    candidates: [...new Set(candidates.map(candidate => path.resolve(candidate)))].sort(),
    entriesVisited,
    hasSource,
    hasContent,
  };
}

async function countGeneratedWorkstreams(
  root: string,
  rootRealPath: string,
): Promise<{ active: number; filesRead: number; bytesRead: number }> {
  const directory = path.join(root, '.ath', 'context', 'workstreams');
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const generatedFiles = entries.filter(entry => (
      entry.isFile() && /^workstream-[a-z0-9_-]+-[a-f0-9]{12}\.json$/i.test(entry.name)
    ));
    let active = 0;
    let filesRead = 0;
    let bytesRead = 0;
    for (const entry of generatedFiles) {
      try {
        const buffer = await readFileNoFollow(path.join(directory, entry.name), rootRealPath);
        filesRead += 1;
        bytesRead += buffer.byteLength;
        const workstream = JSON.parse(buffer.toString('utf8')) as { status?: string };
        if (
          !['archived', 'completed', 'cancelled', 'deleted', 'closed']
            .includes(workstream.status?.toLowerCase() ?? 'active')
        ) active += 1;
      } catch {
        // A broken generated projection is not counted as an active workstream.
      }
    }
    return { active, filesRead, bytesRead };
  } catch {
    return { active: 0, filesRead: 0, bytesRead: 0 };
  }
}

export async function inspectProjectPath(
  projectPath: string,
  options: {
    allowInvalidGeneratedContext?: boolean;
    cachedContext?: {
      projectName: string;
      checkpointSignature: string;
    };
  } = {},
): Promise<{ inspection: ProjectContextInspection; diagnostics: ProjectScanDiagnostics }> {
  const started = performance.now();
  const root = await validateDirectory(projectPath);
  const rootRealPath = await realpath(root);
  const names = await readDirectoryNames(root);
  const contextDirectory = path.join(root, '.ath', 'context');
  const manifestPath = path.join(contextDirectory, 'manifest.json');
  const checkpointPath = path.join(contextDirectory, PROJECT_CONTEXT_MANIFEST_CHECKPOINT_FILE);
  for (const generatedAncestor of [path.join(root, '.ath'), contextDirectory]) {
    try {
      const metadata = await lstat(generatedAncestor);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new ProjectContextError(
          'project_context_unreadable',
          `项目上下文目录不能是链接或非目录：${generatedAncestor}`,
        );
      }
    } catch (error) {
      if (error instanceof ProjectContextError) throw error;
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw new ProjectContextError(
        'project_context_unreadable',
        `无法验证项目上下文目录：${generatedAncestor}`,
      );
    }
  }
  try {
    const generatedEntries = await readdir(contextDirectory, { withFileTypes: true });
    if (
      generatedEntries.length > 0
      && !generatedEntries.some(entry => (
        entry.isFile() && entry.name === PROJECT_CONTEXT_OWNER_FILE
      ))
    ) {
      throw new ProjectContextError(
        'project_context_unreadable',
        '现有 .ath/context 缺少 ownership marker，拒绝把其中内容当作生成物',
      );
    }
  } catch (error) {
    if (error instanceof ProjectContextError) throw error;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new ProjectContextError(
        'project_context_unreadable',
        `无法验证项目上下文目录：${contextDirectory}`,
      );
    }
  }
  let checkpointSignatureChecks = 0;
  let cachedProjectName: string | undefined;
  if (options.cachedContext) {
    const currentCheckpoint = await readProjectContextCheckpointSignature(root);
    checkpointSignatureChecks = currentCheckpoint.checks;
    if (currentCheckpoint.signature === options.cachedContext.checkpointSignature) {
      cachedProjectName = options.cachedContext.projectName;
    }
  }

  let existingContext = false;
  let manifestProjectName: string | undefined;
  let manifestFilesRead = 0;
  let manifestBytesRead = 0;
  if (cachedProjectName) {
    existingContext = true;
    manifestProjectName = cachedProjectName;
  } else {
    try {
      const ownerBuffer = await readFileNoFollow(
        path.join(root, '.ath', 'context', PROJECT_CONTEXT_OWNER_FILE),
        rootRealPath,
      );
      const owner = JSON.parse(ownerBuffer.toString('utf8')) as {
        schemaVersion?: number;
        generator?: string;
        root?: string;
      };
      const ownerRoot = owner.root ? path.resolve(owner.root) : '';
      const expectedOwnerRoot = process.platform === 'win32' ? root.toLowerCase() : root;
      const actualOwnerRoot = process.platform === 'win32' ? ownerRoot.toLowerCase() : ownerRoot;
      if (
        owner.schemaVersion !== PROJECT_CONTEXT_SCHEMA_VERSION
        || owner.generator !== PROJECT_CONTEXT_GENERATOR
        || !ownerRoot
        || expectedOwnerRoot !== actualOwnerRoot
      ) {
        throw new ProjectContextError(
          'project_context_unreadable',
          '项目上下文 ownership marker 无效，请检查目录或重新初始化',
        );
      }
      const manifestBuffer = await readFileNoFollow(manifestPath, rootRealPath);
      let checkpointBuffer: Buffer;
      try {
        checkpointBuffer = await readFileNoFollow(checkpointPath, rootRealPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ProjectContextError(
            'project_context_unreadable',
            '项目上下文 manifest integrity checkpoint 缺失，请显式刷新',
          );
        }
        throw error;
      }
      manifestFilesRead = 3;
      manifestBytesRead = ownerBuffer.byteLength
        + manifestBuffer.byteLength
        + checkpointBuffer.byteLength;
      const manifest = validateProjectContextManifest(
        JSON.parse(manifestBuffer.toString('utf8')) as unknown,
        root,
      );
      validateManifestIntegrityCheckpoint(
        root,
        manifest,
        JSON.parse(checkpointBuffer.toString('utf8')) as unknown,
      );
      await validateManifestOwnerSources(root, manifest);
      existingContext = true;
      manifestProjectName = manifest.project.name;
    } catch (error) {
      if (error instanceof ProjectContextError && !options.allowInvalidGeneratedContext) throw error;
      if (
        error instanceof SyntaxError
        && !options.allowInvalidGeneratedContext
      ) {
        throw new ProjectContextError(
          'project_context_unreadable',
          '项目上下文 manifest 不是有效 JSON，请显式刷新',
        );
      }
      if (
        !(error instanceof ProjectContextError)
        && !(error instanceof SyntaxError)
        && (error as NodeJS.ErrnoException).code !== 'ENOENT'
        && !options.allowInvalidGeneratedContext
      ) {
        throw new ProjectContextError(
          'project_context_unreadable',
          `无法读取项目上下文：${manifestPath}`,
        );
      }
      existingContext = false;
    }
  }

  let classification: ProjectContextInspection['classification'];
  let candidates: string[] = [];
  let entriesVisited = names.length + checkpointSignatureChecks;
  if (existingContext) {
    classification = 'existing_context';
  } else if (hasRootMarker(names)) {
    classification = 'codebase';
  } else {
    const discovery = await discoverCandidateRoots(root, 2);
    entriesVisited += discovery.entriesVisited;
    candidates = discovery.candidates;
    if (candidates.length > 1) classification = 'ambiguous_workspace';
    else if (candidates.length === 1) classification = 'single_candidate';
    else if (discovery.hasSource) classification = 'codebase';
    else classification = 'empty';
  }

  const workstreamCount = existingContext
    ? await countGeneratedWorkstreams(root, rootRealPath)
    : { active: 0, filesRead: 0, bytesRead: 0 };
  const durationMs = Number((performance.now() - started).toFixed(3));
  return {
    inspection: {
      selectedPath: path.resolve(projectPath),
      root,
      projectName: (manifestProjectName ?? path.basename(root)) || root,
      classification,
      existingContext,
      candidates,
      activeWorkstreamCount: workstreamCount.active,
    },
    diagnostics: {
      cacheHit: false,
      entriesVisited,
      filesRead: manifestFilesRead + workstreamCount.filesRead,
      bytesRead: manifestBytesRead + workstreamCount.bytesRead,
      indexedDocuments: 0,
      indexedModules: 0,
      selectedKnowledgeCount: 0,
      freshnessChecks: 0,
      durationMs,
      truncated: entriesVisited >= MAX_ENTRIES,
      freshnessCoverage: 'complete',
    },
  };
}

function instructionMetadata(relativePath: string): Omit<ProjectInstructionEntry, 'title'> | undefined {
  const normalized = normalizeRelative(relativePath);
  const lower = normalized.toLowerCase();
  const basename = path.posix.basename(lower);
  const directory = path.posix.dirname(normalized);
  const depth = directory === '.' ? 0 : directory.split('/').length;

  if (basename === 'agents.override.md') {
    return {
      path: normalized,
      appliesTo: directory,
      priority: 110 + depth,
      authority: 'explicit',
      kind: 'instruction',
    };
  }
  if (['agents.md', 'claude.md', 'gemini.md'].includes(basename)) {
    return {
      path: normalized,
      appliesTo: directory,
      priority: 100 + depth,
      authority: 'explicit',
      kind: 'instruction',
    };
  }
  if (
    lower === '.github/copilot-instructions.md'
    || (lower.startsWith('.github/instructions/') && lower.endsWith('.instructions.md'))
  ) {
    return {
      path: normalized,
      appliesTo: '.',
      priority: 95,
      authority: 'explicit',
      kind: 'instruction',
    };
  }
  if (lower.startsWith('docs/standards/') && DOCUMENT_EXTENSIONS.has(path.posix.extname(lower))) {
    return {
      path: normalized,
      appliesTo: '.',
      priority: 90,
      authority: 'explicit',
      kind: 'standard',
    };
  }
  if (
    lower === 'specs/readme.md'
    || (lower.startsWith('specs/') && /\/(?:spec|checklist)\.md$/.test(lower))
  ) {
    return {
      path: normalized,
      appliesTo: '.',
      priority: 80,
      authority: 'explicit',
      kind: 'active-spec',
    };
  }
  return undefined;
}

function isDocumentCandidate(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  const lower = normalized.toLowerCase();
  if (!DOCUMENT_EXTENSIONS.has(path.posix.extname(lower))) return false;
  return (
    path.posix.dirname(lower) === '.'
    || lower.startsWith('docs/')
    || lower.startsWith('specs/')
    || lower.startsWith('architecture/')
    || lower.startsWith('design/')
    || lower.startsWith('.github/')
    || Boolean(instructionMetadata(normalized))
  );
}

function cleanMarkdown(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/[`*_>#|[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function summarizeDocument(relativePath: string, content: string): { title: string; summary: string } {
  const heading = content.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  const fallbackTitle = path.posix.basename(relativePath, path.posix.extname(relativePath))
    .replace(/[-_]+/g, ' ');
  const paragraphs = content
    .split(/\r?\n\s*\r?\n/)
    .filter(paragraph => !/^\s*#/.test(paragraph))
    .map(cleanMarkdown)
    .filter(paragraph => paragraph.length > 20 && !paragraph.startsWith('---'));
  return {
    title: cleanMarkdown(heading ?? fallbackTitle).slice(0, 140),
    summary: (paragraphs[0] ?? 'Project documentation entry.').slice(0, 320),
  };
}

function githubInstructionApplyTo(content: string, fallback: string): string {
  const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const value = frontmatter?.[1].match(/^\s*applyTo\s*:\s*["']?([^"'\r\n]+)["']?\s*$/mi)?.[1]?.trim();
  return value || fallback;
}

function knowledgeMetadata(relativePath: string): Pick<
  ProjectKnowledgeEntry,
  'layer' | 'tags' | 'freshness' | 'priority'
> {
  const lower = normalizeRelative(relativePath).toLowerCase();
  if (instructionMetadata(relativePath)) {
    return {
      layer: 'norms-constraints',
      tags: ['instructions', lower.includes('specs/') ? 'spec' : 'governance'],
      freshness: 'stable',
      priority: 100,
    };
  }
  if (
    lower.includes('/evaluation/')
    || lower.includes('benchmark')
    || lower.includes('评测')
  ) {
    return {
      layer: 'knowledge',
      tags: ['evaluation', 'evidence', 'change-record'],
      freshness: 'structural',
      priority: 88,
    };
  }
  if (
    lower.includes('architecture')
    || lower.includes('/adr')
    || lower.includes('/design')
    || lower.includes('topology')
  ) {
    return {
      layer: 'topology',
      tags: ['architecture', 'design'],
      freshness: 'structural',
      priority: 75,
    };
  }
  if (
    lower.includes('contributing')
    || lower.includes('development')
    || lower.includes('setup')
    || lower.includes('runbook')
    || lower.includes('deploy')
  ) {
    return {
      layer: 'development',
      tags: ['development', 'operations'],
      freshness: 'structural',
      priority: 72,
    };
  }
  return {
    layer: 'knowledge',
    tags: ['documentation'],
    freshness: 'structural',
    priority: lower.endsWith('readme.md') ? 70 : 50,
  };
}

function detectPackageManager(fileNames: Set<string>): string | undefined {
  if (fileNames.has('pnpm-lock.yaml')) return 'pnpm';
  if (fileNames.has('yarn.lock')) return 'yarn';
  if (fileNames.has('bun.lock') || fileNames.has('bun.lockb')) return 'bun';
  if (fileNames.has('package-lock.json')) return 'npm';
  return undefined;
}

function commandForScript(packageManager: string | undefined, script: string): string {
  if (packageManager === 'pnpm') return `pnpm ${script}`;
  if (packageManager === 'yarn') return `yarn ${script}`;
  if (packageManager === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}

function detectTechnologies(relativeFiles: string[], packageJson?: Record<string, unknown>): string[] {
  const technologies = new Set<string>();
  const extensions = new Set(relativeFiles.map(file => path.posix.extname(file).toLowerCase()));
  if (extensions.has('.ts') || extensions.has('.tsx')) technologies.add('TypeScript');
  if (extensions.has('.js') || extensions.has('.jsx') || extensions.has('.mjs') || extensions.has('.cjs')) technologies.add('JavaScript');
  if (extensions.has('.py')) technologies.add('Python');
  if (extensions.has('.go')) technologies.add('Go');
  if (extensions.has('.rs')) technologies.add('Rust');
  if (extensions.has('.java') || extensions.has('.kt')) technologies.add('JVM');
  if (extensions.has('.cs')) technologies.add('.NET');
  const dependencyNames = new Set([
    ...Object.keys((packageJson?.dependencies as Record<string, unknown> | undefined) ?? {}),
    ...Object.keys((packageJson?.devDependencies as Record<string, unknown> | undefined) ?? {}),
  ]);
  if (dependencyNames.has('next')) technologies.add('Next.js');
  if (dependencyNames.has('react')) technologies.add('React');
  if (relativeFiles.some(file => file.toLowerCase() === 'cargo.toml')) technologies.add('Cargo');
  if (relativeFiles.some(file => file.toLowerCase() === 'go.mod')) technologies.add('Go modules');
  return [...technologies].sort();
}

function freshnessPriority(input: ProjectFreshnessInput): number {
  if (input.kind === 'directory') return 80;
  const lower = input.path.toLowerCase();
  if (
    lower === 'package.json'
    || lower.endsWith('lock.yaml')
    || lower.endsWith('lock.json')
    || lower === '.git/head'
    || lower === '.git/index'
  ) return 120;
  if (instructionMetadata(input.path)) return 110;
  if (isDocumentCandidate(input.path)) return 100;
  if (isSourceFile(input.path)) return 95;
  return 20;
}

function fingerprintFreshness(inputs: ProjectFreshnessInput[]): string {
  return createHash('sha256')
    .update(JSON.stringify(inputs.map(input => [
      input.path,
      input.kind,
      Number(input.mtimeMs.toFixed(3)),
      input.size,
    ])))
    .digest('hex');
}

export async function scanProject(
  root: string,
  revision: number,
  projectKind: 'codebase' | 'empty',
): Promise<ScanOutput> {
  const started = performance.now();
  const rootRealPath = await realpath(root);
  const diagnostics: ProjectScanDiagnostics = {
    cacheHit: false,
    entriesVisited: 0,
    filesRead: 0,
    bytesRead: 0,
    indexedDocuments: 0,
    indexedModules: 0,
    selectedKnowledgeCount: 0,
    freshnessChecks: 0,
    durationMs: 0,
    truncated: false,
    freshnessCoverage: 'complete',
  };
  const generatedAt = new Date().toISOString();
  const freshness: ProjectFreshnessInput[] = [];
  const relativeFiles: string[] = [];
  const sourcePaths: string[] = [];
  const documentPaths: string[] = [];
  const contentCache = new Map<string, string>();
  const rootMetadata = await lstat(root);
  freshness.push({
    path: '.',
    kind: 'directory',
    mtimeMs: rootMetadata.mtimeMs,
    size: rootMetadata.size,
  });

  async function readText(absolutePath: string): Promise<string> {
    const cached = contentCache.get(absolutePath);
    if (cached !== undefined) return cached;
    const buffer = await readFileNoFollow(absolutePath, rootRealPath);
    const slice = buffer.subarray(0, MAX_READ_BYTES);
    if (slice.includes(0)) {
      contentCache.set(absolutePath, '');
      return '';
    }
    const value = slice.toString('utf8');
    diagnostics.filesRead += 1;
    diagnostics.bytesRead += slice.byteLength;
    contentCache.set(absolutePath, value);
    return value;
  }

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || diagnostics.entriesVisited >= MAX_ENTRIES) {
      diagnostics.truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      diagnostics.truncated = true;
      return;
    }
    diagnostics.entriesVisited += entries.length;
    if (diagnostics.entriesVisited >= MAX_ENTRIES) diagnostics.truncated = true;

    if (directory !== root) {
      try {
        const metadata = await lstat(directory);
        freshness.push({
          path: normalizeRelative(path.relative(root, directory)),
          kind: 'directory',
          mtimeMs: metadata.mtimeMs,
          size: metadata.size,
        });
      } catch {
        // A concurrently removed directory is represented by the parent mtime.
      }
    }

    for (const entry of entries) {
      if (diagnostics.entriesVisited > MAX_ENTRIES) break;
      if (entry.isSymbolicLink()) continue;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizeRelative(path.relative(root, absolutePath));
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) await visit(absolutePath, depth + 1);
        continue;
      }
      if (!entry.isFile() || isSensitiveFile(relativePath)) continue;

      let metadata;
      try {
        metadata = await lstat(absolutePath);
      } catch {
        continue;
      }
      relativeFiles.push(relativePath);
      freshness.push({
        path: relativePath,
        kind: 'file',
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      });
      if (isSourceFile(relativePath)) {
        if (sourcePaths.length < MAX_MODULES) sourcePaths.push(relativePath);
        else diagnostics.truncated = true;
      }
      if (isDocumentCandidate(relativePath)) {
        if (documentPaths.length < MAX_DOCUMENTS) documentPaths.push(relativePath);
        else diagnostics.truncated = true;
      }
    }
  }

  await visit(root, 0);

  for (const gitRelative of ['.git/HEAD', '.git/index']) {
    try {
      const metadata = await lstat(path.join(root, ...gitRelative.split('/')));
      freshness.push({
        path: gitRelative,
        kind: 'file',
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      });
    } catch {
      // Git metadata is optional.
    }
  }

  const packageManager = detectPackageManager(new Set(relativeFiles.map(file => file.toLowerCase())));
  let packageJson: Record<string, unknown> | undefined;
  const commands: ProjectCommandEntry[] = [];
  const packagePath = relativeFiles.find(file => file.toLowerCase() === 'package.json');
  if (packagePath) {
    try {
      packageJson = JSON.parse(await readText(path.join(root, packagePath))) as Record<string, unknown>;
      const scripts = packageJson.scripts as Record<string, unknown> | undefined;
      for (const name of Object.keys(scripts ?? {}).sort().slice(0, 40)) {
        if (typeof scripts?.[name] !== 'string') continue;
        commands.push({
          name,
          command: commandForScript(packageManager, name),
          source: packagePath,
          authority: 'explicit',
        });
      }
    } catch {
      // An unreadable package.json remains a freshness source but yields no trusted commands.
    }
  }

  const makefilePath = relativeFiles.find(file => file.toLowerCase() === 'makefile');
  if (makefilePath) {
    try {
      const makefile = await readText(path.join(root, makefilePath));
      for (const match of makefile.matchAll(/^([A-Za-z0-9][\w.-]*):(?:\s|$)/gm)) {
        if (match[1].startsWith('.')) continue;
        commands.push({
          name: `make:${match[1]}`,
          command: `make ${match[1]}`,
          source: makefilePath,
          authority: 'explicit',
        });
      }
    } catch {
      // Ignore command extraction failure; source remains indexed.
    }
  }

  const instructions: ProjectInstructionEntry[] = [];
  const knowledge: ProjectKnowledgeEntry[] = [];
  for (const relativePath of documentPaths.sort()) {
    let content = '';
    try {
      content = await readText(path.join(root, ...relativePath.split('/')));
    } catch {
      continue;
    }
    if (!content) continue;
    const summary = summarizeDocument(relativePath, content);
    const instruction = instructionMetadata(relativePath);
    if (instruction) {
      instructions.push({
        ...instruction,
        appliesTo: relativePath.toLowerCase().startsWith('.github/instructions/')
          ? githubInstructionApplyTo(content, instruction.appliesTo)
          : instruction.appliesTo,
        title: summary.title,
      });
    }
    const metadata = knowledgeMetadata(relativePath);
    knowledge.push({
      id: createHash('sha256').update(relativePath).digest('hex').slice(0, 16),
      ...metadata,
      path: relativePath,
      title: summary.title,
      summary: summary.summary,
      authority: 'explicit',
    });
  }

  instructions.sort((left, right) => (
    right.priority - left.priority || left.path.localeCompare(right.path)
  ));
  knowledge.sort((left, right) => (
    right.priority - left.priority || left.path.localeCompare(right.path)
  ));

  const topologySources: TopologySource[] = [];
  for (const relativePath of sourcePaths.sort()) {
    try {
      topologySources.push({
        path: relativePath,
        content: await readText(path.join(root, ...relativePath.split('/'))),
      });
    } catch {
      diagnostics.truncated = true;
    }
  }
  const topology = buildCodeTopology(
    topologySources,
    revision,
    generatedAt,
    diagnostics.truncated,
  );

  const freshnessInputs = freshness
    .sort((left, right) => (
      freshnessPriority(right) - freshnessPriority(left)
      || left.path.localeCompare(right.path)
    ))
    .slice(0, MAX_FRESHNESS_INPUTS)
    .sort((left, right) => left.path.localeCompare(right.path));
  const requiredFreshnessKeys = new Set(
    freshness
      .filter(input => (
        input.kind === 'directory'
        || sourcePaths.includes(input.path)
        || documentPaths.includes(input.path)
        || hasRootMarker([path.posix.basename(input.path)])
        || input.path === '.git/HEAD'
        || input.path === '.git/index'
      ))
      .map(input => `${input.kind}:${input.path}`),
  );
  const selectedFreshnessKeys = new Set(
    freshnessInputs.map(input => `${input.kind}:${input.path}`),
  );
  diagnostics.freshnessCoverage = [...requiredFreshnessKeys]
    .every(key => selectedFreshnessKeys.has(key))
    ? 'complete'
    : 'incomplete';
  if (freshness.length > MAX_FRESHNESS_INPUTS) diagnostics.truncated = true;

  diagnostics.indexedDocuments = knowledge.length;
  diagnostics.indexedModules = topology.modules.length;
  diagnostics.durationMs = Number((performance.now() - started).toFixed(3));
  diagnostics.truncated ||= topology.truncated;
  if (diagnostics.truncated) diagnostics.freshnessCoverage = 'incomplete';
  const projectName = typeof packageJson?.name === 'string' && packageJson.name.trim()
    ? packageJson.name.trim()
    : path.basename(root) || root;

  return {
    projectName,
    projectKind,
    technologies: detectTechnologies(relativeFiles, packageJson),
    packageManager,
    instructions,
    commands: commands
      .filter((command, index, all) => (
        all.findIndex(candidate => candidate.command === command.command) === index
      ))
      .slice(0, 50),
    knowledge,
    topology,
    freshnessInputs,
    sourceFingerprint: fingerprintFreshness(freshnessInputs),
    diagnostics,
  };
}

export function fingerprintCurrentInputs(inputs: ProjectFreshnessInput[]): string {
  return fingerprintFreshness(inputs);
}

export async function readCurrentFreshness(
  root: string,
  inputs: ProjectFreshnessInput[],
): Promise<{ inputs: ProjectFreshnessInput[]; checks: number; changed: boolean }> {
  const current: ProjectFreshnessInput[] = [];
  const checkedDirectories = new Set<string>();
  let changed = false;
  for (const input of inputs) {
    const absolutePath = resolveProjectManifestPath(root, input.path, { allowRoot: true });
    await assertManifestPathHasNoLinkedAncestor(root, input.path, checkedDirectories);
    try {
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        throw new ProjectContextError(
          'project_context_unreadable',
          '项目上下文 freshness path 不能是链接，请显式刷新',
        );
      }
      const next: ProjectFreshnessInput = {
        path: input.path,
        kind: metadata.isDirectory() ? 'directory' : 'file',
        mtimeMs: metadata.mtimeMs,
        size: metadata.size,
      };
      current.push(next);
      if (
        next.kind !== input.kind
        || Number(next.mtimeMs.toFixed(3)) !== Number(input.mtimeMs.toFixed(3))
        || next.size !== input.size
      ) changed = true;
    } catch (error) {
      if (error instanceof ProjectContextError) throw error;
      changed = true;
    }
  }
  return { inputs: current, checks: inputs.length, changed };
}

export { PROJECT_CONTEXT_SCHEMA_VERSION };
