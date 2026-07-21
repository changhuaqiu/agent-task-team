import path from 'node:path';
import type {
  CodeTopology,
  CodeTopologyEdge,
  CodeTopologyModule,
  RankedTopologyModule,
} from './types';

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.kts',
  '.cs', '.rb', '.php', '.swift', '.vue', '.svelte',
]);

const MODULE_EXTENSIONS = [
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.py',
];

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript React',
  '.mts': 'TypeScript',
  '.cts': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript React',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
};

export interface TopologySource {
  path: string;
  content: string;
}

function normalize(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function moduleKind(filePath: string): CodeTopologyModule['kind'] {
  const lower = filePath.toLowerCase();
  if (
    lower.includes('/__tests__/')
    || /\.(?:test|spec)\.[^.]+$/.test(lower)
    || lower.startsWith('test/')
    || lower.startsWith('tests/')
  ) return 'test';
  if (
    /(?:^|\/)(?:[^/]+\.)?config\.[^/]+$/.test(lower)
    || /(?:^|\/)(?:package\.json|pyproject\.toml|go\.mod|cargo\.toml|pom\.xml)$/.test(lower)
  ) return lower.endsWith('.json') || lower.endsWith('.toml') || lower.endsWith('.mod') || lower.endsWith('.xml')
    ? 'manifest'
    : 'config';
  return 'source';
}

function isEntrypoint(filePath: string): boolean {
  const lower = normalize(filePath).toLowerCase();
  const base = path.posix.basename(lower, path.posix.extname(lower));
  return (
    ['main', 'index', 'app', 'server', 'cli', '__main__'].includes(base)
    || lower.startsWith('src/pages/')
    || lower.startsWith('pages/')
    || lower.includes('/api/')
    || /(?:^|\/)(?:route|page)\.[^.]+$/.test(lower)
  );
}

function extractTypeScriptImports(content: string): string[] {
  const imports = new Set<string>();
  const patterns = [
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports];
}

function extractPythonImports(content: string): string[] {
  const imports = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const fromMatch = line.match(/^\s*from\s+([.\w]+)\s+import\s+/);
    if (fromMatch) imports.add(fromMatch[1]);
    const importMatch = line.match(/^\s*import\s+([\w.]+)/);
    if (importMatch) imports.add(importMatch[1]);
  }
  return [...imports];
}

function extractSymbols(filePath: string, content: string): string[] {
  const extension = path.posix.extname(filePath).toLowerCase();
  const symbols = new Set<string>();
  if (extension === '.py') {
    for (const match of content.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z_][\w]*)/gm)) {
      symbols.add(match[1]);
    }
  } else if (['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
    for (const match of content.matchAll(/\bexport\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:class|function|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g)) {
      symbols.add(match[1]);
    }
    for (const match of content.matchAll(/\bexports\.([A-Za-z_$][\w$]*)\s*=/g)) {
      symbols.add(match[1]);
    }
  }
  return [...symbols].sort().slice(0, 24);
}

function resolveTypeScriptImport(
  from: string,
  specifier: string,
  available: Set<string>,
): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const base = normalize(path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier)));
  const runtimeExtension = path.posix.extname(base).toLowerCase();
  const sourceBase = ['.js', '.jsx', '.mjs', '.cjs'].includes(runtimeExtension)
    ? base.slice(0, -runtimeExtension.length)
    : undefined;
  const candidates = [
    base,
    ...(sourceBase
      ? ['.ts', '.tsx', '.mts', '.cts'].map(extension => `${sourceBase}${extension}`)
      : []),
    ...MODULE_EXTENSIONS.map(extension => `${base}${extension}`),
    ...MODULE_EXTENSIONS.map(extension => `${base}/index${extension}`),
  ];
  return candidates.find(candidate => available.has(candidate));
}

function resolvePythonImport(
  from: string,
  specifier: string,
  available: Set<string>,
): string | undefined {
  if (!specifier.startsWith('.')) {
    const absoluteBase = specifier.replaceAll('.', '/');
    return [`${absoluteBase}.py`, `${absoluteBase}/__init__.py`]
      .find(candidate => available.has(candidate));
  }
  const leading = specifier.match(/^\.+/)?.[0].length ?? 0;
  let directory = path.posix.dirname(from);
  for (let index = 1; index < leading; index += 1) directory = path.posix.dirname(directory);
  const modulePart = specifier.slice(leading).replaceAll('.', '/');
  const base = normalize(path.posix.join(directory, modulePart));
  return [`${base}.py`, `${base}/__init__.py`, `${directory}/__init__.py`]
    .find(candidate => available.has(candidate));
}

export function isSourceFile(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.posix.extname(normalize(filePath)).toLowerCase());
}

export function buildCodeTopology(
  sources: TopologySource[],
  revision: number,
  generatedAt: string,
  truncated: boolean,
): CodeTopology {
  const normalizedSources = sources
    .map(source => ({ ...source, path: normalize(source.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const available = new Set(normalizedSources.map(source => source.path));
  const modules: CodeTopologyModule[] = normalizedSources.map(source => {
    const extension = path.posix.extname(source.path).toLowerCase();
    return {
      path: source.path,
      language: LANGUAGE_BY_EXTENSION[extension] ?? (extension.slice(1).toUpperCase() || 'Unknown'),
      kind: moduleKind(source.path),
      exportedSymbols: extractSymbols(source.path, source.content),
      inbound: 0,
      outbound: 0,
      entrypoint: isEntrypoint(source.path),
    };
  });
  const moduleByPath = new Map(modules.map(codeModule => [codeModule.path, codeModule]));
  const edgeKeys = new Set<string>();
  const edges: CodeTopologyEdge[] = [];
  let unresolvedImports = 0;

  for (const source of normalizedSources) {
    const extension = path.posix.extname(source.path).toLowerCase();
    const imports = extension === '.py'
      ? extractPythonImports(source.content)
      : ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)
        ? extractTypeScriptImports(source.content)
        : [];
    for (const specifier of imports) {
      const target = extension === '.py'
        ? resolvePythonImport(source.path, specifier, available)
        : resolveTypeScriptImport(source.path, specifier, available);
      if (!target) {
        if (specifier.startsWith('.')) unresolvedImports += 1;
        continue;
      }
      const key = `${source.path}\0${target}`;
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      edges.push({ from: source.path, to: target, kind: 'import' });
      const fromModule = moduleByPath.get(source.path);
      const targetModule = moduleByPath.get(target);
      if (fromModule) fromModule.outbound += 1;
      if (targetModule) targetModule.inbound += 1;
    }
  }

  const entrypoints = modules
    .filter(codeModule => codeModule.entrypoint)
    .map(codeModule => codeModule.path);
  return {
    schemaVersion: 1,
    revision,
    generatedAt,
    precision: 'heuristic',
    entrypoints,
    modules,
    edges: edges.sort((left, right) => (
      left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
    )),
    unresolvedImports,
    truncated,
  };
}

function tokenize(value: string): Set<string> {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new Set(
    expanded
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .map(token => token.trim())
      .filter(token => token.length > 1),
  );
}

export function rankTopology(
  topology: CodeTopology,
  requestText: string,
  limit = 12,
): RankedTopologyModule[] {
  const queryTokens = tokenize(requestText);
  const neighbors = new Map<string, Set<string>>();
  for (const edge of topology.edges) {
    if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(edge.from)!.add(edge.to);
    neighbors.get(edge.to)!.add(edge.from);
  }

  return topology.modules
    .map(codeModule => {
      const pathTokens = tokenize(codeModule.path);
      const symbolTokens = tokenize(codeModule.exportedSymbols.join(' '));
      let overlap = 0;
      for (const token of queryTokens) {
        if (pathTokens.has(token)) overlap += 10;
        if (symbolTokens.has(token)) overlap += 8;
      }
      const score = overlap
        + (codeModule.entrypoint ? 5 : 0)
        + Math.log2(codeModule.inbound + 1) * 2
        + (codeModule.kind === 'source' ? 1 : 0);
      return {
        ...codeModule,
        score: Number(score.toFixed(3)),
        neighbors: [...(neighbors.get(codeModule.path) ?? [])].sort().slice(0, 6),
      };
    })
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function topologyToMarkdown(topology: CodeTopology, modules = rankTopology(topology, '', 24)): string {
  const lines = [
    '# Code Topology',
    '',
    '> Generated navigation index. Precision is heuristic; owner source files remain authoritative.',
    '',
    `- Revision: ${topology.revision}`,
    `- Modules: ${topology.modules.length}`,
    `- Dependency edges: ${topology.edges.length}`,
    `- Entrypoints: ${topology.entrypoints.length}`,
    `- Unresolved relative imports: ${topology.unresolvedImports}`,
    `- Truncated: ${topology.truncated ? 'yes' : 'no'}`,
    '',
    '## High-signal modules',
    '',
  ];
  for (const codeModule of modules) {
    lines.push(
      `- \`${codeModule.path}\` — ${codeModule.language}; ${codeModule.kind}; in ${codeModule.inbound} / out ${codeModule.outbound}`
      + (codeModule.exportedSymbols.length ? `; exports ${codeModule.exportedSymbols.slice(0, 8).join(', ')}` : ''),
    );
  }
  return `${lines.join('\n')}\n`;
}
