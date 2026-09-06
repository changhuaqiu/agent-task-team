import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { projectRepo } from '../repositories/project-repo';
import { projectArtifactLedger } from './project-artifact-ledger';
import { readWorkResult } from './work-result';
import { redactObservationPreview } from '../observability/redaction';
import type { ArtifactPreview } from '@/shared/work-result';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.yaml', '.yml', '.toml', '.xml', '.csv', '.log', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.html', '.css', '.scss', '.svg', '.py', '.rs', '.go', '.java', '.sql', '.sh', '.ps1']);
const IMAGES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const BLOCKED = /^(?:\.env(?:\..*)?|\.git|\.ath|\.ssh|\.aws|\.azure|\.config|node_modules|credentials(?:\..*)?|secrets?(?:\..*)?|id_rsa|id_ed25519)$/i;
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function allowedPath(ref: string): boolean {
  return !ref.split(/[\\/]/).some((segment) => BLOCKED.test(segment))
    && !/\.(?:pem|key|p12|pfx|db|sqlite|sqlite3)$/i.test(ref)
    && !ref.includes('\0') && !/^[a-z][a-z\d+.-]*:/i.test(ref);
}

/** Exported for deterministic filesystem boundary tests; production enters via readArtifactPreview. */
export async function readProjectFilePreview(root: string, ref: string): Promise<ArtifactPreview> {
  if (!allowedPath(ref) || path.isAbsolute(ref)) throw new Error('preview_forbidden');
  const canonicalRoot = await realpath(root);
  const candidate = path.resolve(canonicalRoot, ref);
  if (!inside(canonicalRoot, candidate)) throw new Error('preview_forbidden');
  const resolved = await realpath(candidate);
  if (!inside(canonicalRoot, resolved) || !allowedPath(path.relative(canonicalRoot, resolved))) throw new Error('preview_forbidden');
  const extension = path.extname(resolved).toLowerCase();
  const imageType = IMAGES[extension];
  if (!imageType && !TEXT_EXTENSIONS.has(extension)) throw new Error('preview_unsupported');
  const handle = await open(resolved, 'r');
  try {
    const stat = await handle.stat();
    const limit = imageType ? 4 * 1024 * 1024 : 256 * 1024;
    if (!stat.isFile() || stat.size > limit) throw new Error('preview_too_large');
    // Bounded read even if an Agent grows the file after stat.
    const buffer = Buffer.alloc(limit + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > limit) throw new Error('preview_too_large');
    const data = buffer.subarray(0, bytesRead);
    const metadata = { ref, sha256: createHash('sha256').update(data).digest('hex'), modifiedAt: stat.mtime.toISOString() };
    if (imageType) return { ...metadata, kind: 'image', dataUrl: `data:${imageType};base64,${data.toString('base64')}` };
    if (data.includes(0)) throw new Error('preview_unsupported');
    const original = data.toString('utf8');
    const content = redactObservationPreview(original, limit) ?? '';
    return { ...metadata, kind: 'text', content, redacted: content !== original };
  } finally { await handle.close(); }
}

export async function readArtifactPreview(input: {
  projectId: string; artifactId?: string; conversationId?: string; workId?: string; ref?: string;
}): Promise<ArtifactPreview> {
  const project = projectRepo.getById(input.projectId);
  if (!project) throw new Error('preview_not_found');
  let ref: string | undefined;
  if (input.artifactId) {
    ref = projectArtifactLedger.list(input.projectId, 200, input.conversationId || input.workId ? {
      conversationId: input.conversationId, workIds: input.workId ? [input.workId] : [],
    } : undefined).find((item) => item.id === input.artifactId)?.ref;
  } else if (input.conversationId && input.workId && input.ref) {
    const result = readWorkResult(input.projectId, input.conversationId, input.workId);
    const refs = result.gates.flatMap((gate) => gate.evidence.flatMap((evidence) => evidence.refs));
    refs.push(...result.bundles.flatMap(({ bundle }) => [
      ...bundle.changeRefs, ...bundle.verificationRefs,
      ...(bundle.verification ? [bundle.verification.reportRef, ...bundle.verification.specRefs] : []),
      ...bundle.acceptanceResults.flatMap((criterion) => criterion.evidenceRefs),
    ]));
    if (refs.includes(input.ref)) ref = input.ref;
  }
  if (!ref) throw new Error('preview_not_found');
  try { return await readProjectFilePreview(project.root_path, ref); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('preview_')) throw error;
    throw new Error('preview_unavailable');
  }
}
