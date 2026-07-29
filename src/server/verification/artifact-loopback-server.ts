import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, isAbsolute, relative, resolve } from 'node:path';

const DEFAULT_TTL_MS = 120_000;

export interface ArtifactLoopbackServerResult {
  url: string;
  artifactPath: string;
  byteLength: number;
  expiresAt: string;
}

function resolveProjectArtifact(projectDir: string, artifactPath: string): string {
  const projectRoot = resolve(projectDir);
  const resolvedArtifact = resolve(projectRoot, artifactPath);
  const projectRelativePath = relative(projectRoot, resolvedArtifact);
  if (
    !artifactPath.trim()
    || isAbsolute(projectRelativePath)
    || projectRelativePath === '..'
    || projectRelativePath.startsWith(`..\\`)
    || projectRelativePath.startsWith('../')
  ) {
    throw new Error('artifact_path must resolve inside the current project directory');
  }
  return resolvedArtifact;
}

function browserContentType(artifactPath: string): string {
  switch (extname(artifactPath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    case '.md':
    case '.txt':
    case '.log':
    case '.csv':
      return 'text/plain; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export async function startArtifactLoopbackServer(input: {
  projectDir: string;
  artifactPath: string;
  ttlMs?: number;
}): Promise<ArtifactLoopbackServerResult> {
  const artifactPath = resolveProjectArtifact(input.projectDir, input.artifactPath);
  const body = await readFile(artifactPath);
  const token = randomBytes(24).toString('base64url');
  const route = `/${token}/${encodeURIComponent(basename(artifactPath))}`;
  const ttlMs = Math.max(1, input.ttlMs ?? DEFAULT_TTL_MS);
  const expiresAtMs = Date.now() + ttlMs;

  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': browserContentType(artifactPath),
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
      connection: 'close',
      'x-content-type-options': 'nosniff',
    });
    response.end(body, () => server.close());
  });

  const timer = setTimeout(() => server.close(), ttlMs);
  timer.unref?.();
  server.once('close', () => clearTimeout(timer));
  server.unref();

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('failed to bind artifact loopback server');
  }

  return {
    url: `http://127.0.0.1:${address.port}${route}`,
    artifactPath,
    byteLength: body.byteLength,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}
