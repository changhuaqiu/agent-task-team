import { createHash } from 'node:crypto';
import path from 'node:path';
import { getDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import type {
  ProjectArtifactLedgerItem,
  ProjectArtifactLedgerKind,
} from '@/shared/project-artifact-ledger';

interface RuntimeEventRow {
  type: 'runtime.tool.started' | 'runtime.tool.completed';
  payload: string;
  recorded_at: string;
  invocation_id: string | null;
  project_agent_id: string | null;
  actor_id: string;
  task_id: string | null;
  task_title: string | null;
  invocation_agent_id: string | null;
}

interface RegisteredArtifactRow {
  id: string;
  task_id: string;
  kind: string;
  label: string;
  path: string | null;
  url: string | null;
  proof_event_id: string | null;
  created_at: string;
  actor_id: string | null;
  task_title: string | null;
}

interface OutcomeEvidenceRow {
  id: string;
  work_id: string;
  evidence_refs_json: string;
  recorded_at: string;
  agent_id: string;
  task_id: string | null;
  task_title: string | null;
  goal: string;
}

const MUTATION_TOOL = /(apply[_ -]?patch|edit|write|create|delete|remove|replace|notebook)/i;
const PATH_KEYS = new Set([
  'path', 'file', 'filename', 'file_path', 'filepath', 'target', 'target_path',
  'targetpath', 'notebook_path', 'notebookpath',
]);
const IGNORED_SEGMENTS = new Set(['.ath', '.git', 'node_modules', '.next', 'dist', 'build', 'target']);

function hashId(source: string): string {
  return `artifact-${createHash('sha256').update(source).digest('hex').slice(0, 24)}`;
}

function parsePayload(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function collectPathCandidates(value: unknown, output: string[]): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPathCandidates(item, output));
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && PATH_KEYS.has(key.toLowerCase())) output.push(item);
    else collectPathCandidates(item, output);
  }
}

function pathsFromPatch(value: string, output: string[]): void {
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File:\s*(.+)$/gm,
    /^\+\+\+\s+(?:b\/)?(.+)$/gm,
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) output.push(match[1].trim());
  }
}

function projectPathApi(root: string): typeof path.win32 | typeof path.posix {
  return /^[a-zA-Z]:[\\/]/.test(root) ? path.win32 : path.posix;
}

function normalizeProjectRelativePath(root: string, candidate: string): string | undefined {
  const clean = candidate.trim().replace(/^['"]|['"]$/g, '');
  if (!clean || /^https?:\/\//i.test(clean) || clean.includes('\0')) return undefined;
  const api = projectPathApi(root);
  const resolvedRoot = api.resolve(root);
  const resolved = api.isAbsolute(clean) ? api.resolve(clean) : api.resolve(resolvedRoot, clean);
  const relative = api.relative(resolvedRoot, resolved);
  if (!relative || relative === '.' || relative.startsWith('..') || api.isAbsolute(relative)) return undefined;
  const normalized = relative.replace(/\\/g, '/');
  if (normalized.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))) return undefined;
  return normalized;
}

function outcomeEvidence(root: string, value: string): { ref: string; kind?: ProjectArtifactLedgerKind } | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) {
    if (/\s/.test(raw)) return undefined;
    try {
      const parsed = new URL(raw);
      return ['http:', 'https:'].includes(parsed.protocol) ? { ref: raw } : undefined;
    } catch {
      return undefined;
    }
  }
  const withoutLocation = raw.replace(/:\d+(?:(?:-|:)\d+)?$/, '');
  const typed = raw.match(/^(workspace|file|path):(.*)$/i);
  if (typed) {
    const ref = normalizeProjectRelativePath(
      root,
      typed[2].trim().replace(/:\d+(?:(?:-|:)\d+)?$/, ''),
    );
    return ref ? { ref } : undefined;
  }
  if (/^(test|trace|proof|live-db|disk):/i.test(raw)) return { ref: raw, kind: 'proof' };
  if (/^review:/i.test(raw)) return { ref: raw, kind: 'review' };
  if (/^(?:pr|pull-request):/i.test(raw)) return { ref: raw, kind: 'pull_request' };
  if (/^(?:msg|task|work|invocation)-/i.test(raw) || /^(?:task|work|invocation):/i.test(raw)) return undefined;
  if (!/[\\/]/.test(withoutLocation) && !/\.[a-z0-9]{1,10}$/i.test(withoutLocation)) return undefined;
  const ref = normalizeProjectRelativePath(root, withoutLocation);
  return ref ? { ref } : undefined;
}

function classify(ref: string, sourceKind?: string): ProjectArtifactLedgerKind {
  if (sourceKind === 'pull_request' || /(?:github\.com\/.+\/pull\/|\bpull[_ -]?request\b)/i.test(ref)) return 'pull_request';
  if (sourceKind === 'review') return 'review';
  if (sourceKind === 'proof' || sourceKind === 'log') return 'proof';
  if (/^https?:\/\//i.test(ref)) return 'link';
  if (/(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:spec|test)\.[^.]+$/i.test(ref)) return 'test';
  if (/(^|\/)(?:docs|specs|design|architecture)\/|\.(?:md|mdx|pdf|docx?)$/i.test(ref)) return 'document';
  if (/\.(?:png|jpe?g|gif|webp|svg|fig|pen|sketch)$/i.test(ref)) return 'design';
  if (/\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|swift|rb|php|vue|svelte|css|scss|sql|sh|ps1)$/i.test(ref)) return 'code';
  return 'file';
}

function operation(toolName: string): 'create' | 'edit' | 'delete' {
  if (/delete|remove/i.test(toolName)) return 'delete';
  if (/create|write/i.test(toolName)) return 'create';
  return 'edit';
}

function label(ref: string): string {
  const parts = ref.replace(/\\/g, '/').split('/');
  return parts.at(-1) || ref;
}

function workTitle(taskTitle: string | null, goal: string): string {
  if (taskTitle) return taskTitle;
  if (/^Human request for @/i.test(goal)) return 'Agent 协作结果';
  const normalized = goal.replace(/\s+/g, ' ').trim();
  return normalized.length > 80 ? `${normalized.slice(0, 77)}…` : normalized;
}

function merge(items: ProjectArtifactLedgerItem[], limit: number): ProjectArtifactLedgerItem[] {
  const byRef = new Map<string, ProjectArtifactLedgerItem>();
  for (const item of items.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
    const key = item.ref.toLocaleLowerCase('en-US');
    const prior = byRef.get(key);
    byRef.set(key, prior ? {
      ...prior,
      ...item,
      status: prior.status === 'registered' || item.status === 'registered' ? 'registered' : 'working',
      operations: [...new Set([...prior.operations, ...item.operations])],
      ...(item.workId ? { workId: item.workId, workTitle: item.workTitle } : prior.workId ? { workId: prior.workId, workTitle: prior.workTitle } : {}),
    } : item);
  }
  return [...byRef.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Math.min(200, limit)));
}

export const projectArtifactLedger = {
  list(projectId: string, limit = 100): ProjectArtifactLedgerItem[] {
    const project = projectRepo.getById(projectId);
    if (!project) throw new Error('artifact_project_not_found');
    const registeredRows = getDb().prepare(`
      SELECT artifact.id,artifact.task_id,artifact.kind,artifact.label,artifact.path,artifact.url,
        artifact.proof_event_id,artifact.created_at,action.actor_id,task.title AS task_title
      FROM task_artifact_ref artifact
      JOIN conversation ON conversation.id=artifact.conversation_id
      LEFT JOIN task_action action ON action.id=artifact.created_by_action_id
      LEFT JOIN task ON task.id=artifact.task_id
      WHERE conversation.project_id=?
      ORDER BY artifact.created_at DESC,artifact.id DESC
      LIMIT 500
    `).all(projectId) as RegisteredArtifactRow[];
    const registered = registeredRows.map((row): ProjectArtifactLedgerItem => {
      const rawRef = row.url ?? row.path ?? row.label;
      const ref = row.url
        ? row.url
        : normalizeProjectRelativePath(project.root_path, rawRef) ?? rawRef;
      return {
        id: row.id,
        projectId,
        ref,
        label: row.label || label(ref),
        kind: classify(ref, row.kind),
        status: 'registered',
        updatedAt: row.created_at,
        updatedBy: row.actor_id ?? 'system',
        operations: ['register'],
        workId: row.task_id,
        ...(row.task_title ? { workTitle: row.task_title } : {}),
        ...(row.proof_event_id ? { proofEventId: row.proof_event_id } : {}),
      };
    });

    const outcomeRows = getDb().prepare(`
      SELECT outcome.id,outcome.work_id,outcome.evidence_refs_json,outcome.recorded_at,
        contract.agent_id,contract.task_id,task.title AS task_title,contract.goal
      FROM agent_outcome outcome
      JOIN work_contract contract ON contract.id=outcome.contract_id
      JOIN conversation ON conversation.id=outcome.project_id
      LEFT JOIN task ON task.id=contract.task_id
      WHERE conversation.project_id=? AND outcome.admission_status='accepted'
      ORDER BY outcome.recorded_at DESC,outcome.id DESC
      LIMIT 500
    `).all(projectId) as OutcomeEvidenceRow[];
    const outcomeEvidenceItems = outcomeRows.flatMap((row): ProjectArtifactLedgerItem[] => {
      let refs: unknown;
      try { refs = JSON.parse(row.evidence_refs_json); } catch { refs = []; }
      if (!Array.isArray(refs)) return [];
      return refs.flatMap((value): ProjectArtifactLedgerItem[] => {
        if (typeof value !== 'string') return [];
        const evidence = outcomeEvidence(project.root_path, value);
        if (!evidence) return [];
        return [{
          id: hashId(`outcome:${projectId}:${row.id}:${evidence.ref.toLocaleLowerCase('en-US')}`),
          projectId,
          ref: evidence.ref,
          label: label(evidence.ref),
          kind: evidence.kind ?? classify(evidence.ref),
          status: 'registered',
          updatedAt: row.recorded_at,
          updatedBy: row.agent_id,
          operations: ['register'],
          workId: row.task_id ?? row.work_id,
          workTitle: workTitle(row.task_title, row.goal),
          proofEventId: row.id,
        }];
      });
    });

    const runtimeRows = getDb().prepare(`
      SELECT event.type,event.payload,event.recorded_at,event.invocation_id,
        event.project_agent_id,event.actor_id,invocation.task_id,task.title AS task_title,
        invocation.agent_id AS invocation_agent_id
      FROM platform_event event
      JOIN conversation ON conversation.id=event.project_id
      LEFT JOIN invocation ON invocation.id=event.invocation_id
      LEFT JOIN task ON task.id=invocation.task_id
      WHERE conversation.project_id=?
        AND event.type IN ('runtime.tool.started','runtime.tool.completed')
      ORDER BY event.recorded_at DESC,event.id DESC
      LIMIT 1200
    `).all(projectId) as RuntimeEventRow[];
    const completed = new Set<string>();
    for (const row of runtimeRows) {
      if (row.type !== 'runtime.tool.completed') continue;
      const payload = parsePayload(row.payload);
      const callId = typeof payload?.callId === 'string' ? payload.callId : undefined;
      if (callId) completed.add(`${row.invocation_id ?? ''}:${callId}`);
    }
    const observed: ProjectArtifactLedgerItem[] = [];
    for (const row of runtimeRows) {
      if (row.type !== 'runtime.tool.started') continue;
      const payload = parsePayload(row.payload);
      const toolName = typeof payload?.toolName === 'string' ? payload.toolName : '';
      const callId = typeof payload?.callId === 'string' ? payload.callId : '';
      if (!callId || !MUTATION_TOOL.test(toolName) || !completed.has(`${row.invocation_id ?? ''}:${callId}`)) continue;
      const rawInput = typeof payload?.input === 'string' ? payload.input : '';
      const candidates: string[] = [];
      try { collectPathCandidates(JSON.parse(rawInput), candidates); } catch { /* raw patch/plain input */ }
      pathsFromPatch(rawInput, candidates);
      for (const candidate of candidates) {
        const ref = normalizeProjectRelativePath(project.root_path, candidate);
        if (!ref) continue;
        observed.push({
          id: hashId(`runtime:${projectId}:${ref.toLocaleLowerCase('en-US')}`),
          projectId,
          ref,
          label: label(ref),
          kind: classify(ref),
          status: 'working',
          updatedAt: row.recorded_at,
          updatedBy: row.project_agent_id ?? row.invocation_agent_id ?? row.actor_id,
          operations: [operation(toolName)],
          ...(row.task_id ? { workId: row.task_id } : {}),
          ...(row.task_title ? { workTitle: row.task_title } : {}),
          ...(row.invocation_id ? { invocationId: row.invocation_id } : {}),
        });
      }
    }
    return merge([...observed, ...registered, ...outcomeEvidenceItems], limit);
  },

  listAll(limit = 500): ProjectArtifactLedgerItem[] {
    return projectRepo.list()
      .flatMap((project) => projectArtifactLedger.list(project.id, 200))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(1_000, limit)));
  },
};
