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
  conversation_id: string;
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
  action_type: string | null;
  task_title: string | null;
  conversation_id: string;
}

interface OutcomeEvidenceRow {
  id: string;
  work_id: string;
  outcome_type: 'submit_task_result' | 'request_review' | 'record_gate_decision';
  evidence_refs_json: string;
  recorded_at: string;
  agent_id: string;
  task_id: string | null;
  task_title: string | null;
  goal: string;
  conversation_id: string;
}

interface ArtifactProjectionItem extends ProjectArtifactLedgerItem {
  producerRank: number;
  conversationId: string;
}

interface ArtifactLedgerScope {
  conversationId?: string;
  workIds?: string[];
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
  if (
    !relative
    || relative === '.'
    || relative === '..'
    || relative.startsWith(`..${api.sep}`)
    || api.isAbsolute(relative)
  ) return undefined;
  const normalized = relative.replace(/\\/g, '/');
  const ignored = normalized.split('/').some((segment) => (
    api === path.win32
      ? IGNORED_SEGMENTS.has(segment.toLocaleLowerCase('en-US'))
      : IGNORED_SEGMENTS.has(segment)
  ));
  if (ignored) return undefined;
  if (
    api === path.win32
      ? normalized.toLocaleLowerCase('en-US') === 'tasks.md'
      : normalized === 'TASKS.md'
  ) return undefined;
  return normalized;
}

function stripSourceLocation(value: string): string {
  return value
    .replace(/#L\d+(?:-L?\d+)?$/i, '')
    .replace(/:\d+(?:(?:-|:)\d+)?$/, '');
}

function describedFileCandidate(value: string): string {
  const normalized = value.trim();
  const match = [
    /^(.+?\.[a-z0-9]{1,10}(?:(?::\d+(?:(?:-|:)\d+)?)|(?:#L\d+(?:-L?\d+)?)))\s+.+$/i,
    /^(.+?\.[a-z0-9]{1,10}):\s+.+$/i,
    /^(.+?\.[a-z0-9]{1,10})\s+\(.+\)$/i,
  ].map((pattern) => pattern.exec(normalized)).find(Boolean);
  return stripSourceLocation(match?.[1] ?? normalized);
}

function fileUrlCandidate(value: string): string | undefined {
  if (!/^file:\/{1,3}/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.hostname && url.hostname.toLocaleLowerCase('en-US') !== 'localhost') return undefined;
    const pathname = decodeURIComponent(url.pathname);
    return /^\/[a-zA-Z]:\//.test(pathname) ? pathname.slice(1) : pathname;
  } catch {
    return undefined;
  }
}

function looksLikeArtifactRef(value: string): boolean {
  const normalized = value.trim();
  return /^(?:workspace|file|path|https?|test|trace|proof|live-db|disk|e2e|cmd|review|pr|pull-request):/i.test(normalized)
    || /\.[a-z0-9]{1,10}(?=$|[:#\s(])/i.test(normalized);
}

function splitEvidenceRefs(value: string): string[] {
  const raw = value.trim();
  if (!raw || /^(?:test|trace|proof|live-db|disk|e2e|cmd):/i.test(raw)) return raw ? [raw] : [];
  const parts = raw.split(/\s*,\s*/).filter(Boolean);
  return parts.length > 1 && parts.every(looksLikeArtifactRef) ? parts : [raw];
}

function outcomeEvidence(root: string, value: string): Array<{ ref: string; kind?: ProjectArtifactLedgerKind }> {
  return splitEvidenceRefs(value).flatMap((part) => {
    const raw = part.trim();
    if (!raw) return [];
    if (/^(test|trace|proof|live-db|disk|e2e|cmd):/i.test(raw)) {
      return [{ ref: raw, kind: 'proof' as const }];
    }
    if (/^https?:\/\//i.test(raw)) {
      if (/\s/.test(raw)) return [];
      try {
        const parsed = new URL(raw);
        return ['http:', 'https:'].includes(parsed.protocol) ? [{ ref: raw }] : [];
      } catch {
        return [];
      }
    }
    const typed = raw.match(/^(workspace|path):(.*)$/i);
    if (typed) {
      const ref = normalizeProjectRelativePath(root, describedFileCandidate(typed[2]));
      return ref ? [{ ref }] : [];
    }
    if (/^file:/i.test(raw)) {
      const fileUrl = fileUrlCandidate(raw);
      if (/^file:\/{1,3}/i.test(raw) && !fileUrl) return [];
      const candidate = fileUrl ?? raw.replace(/^file:\s*/i, '');
      const ref = normalizeProjectRelativePath(root, describedFileCandidate(candidate));
      return ref ? [{ ref }] : [];
    }
    const plan = raw.match(/^plan:\s*(.+)$/i);
    if (plan) {
      const ref = normalizeProjectRelativePath(root, describedFileCandidate(plan[1]));
      return ref ? [{ ref, kind: classify(ref) }] : [];
    }
    if (/^review:/i.test(raw)) return [{ ref: raw, kind: 'review' as const }];
    if (/^(?:pr|pull-request):/i.test(raw)) {
      return [{ ref: raw, kind: 'pull_request' as const }];
    }
    if (/^(?:msg|task|work|invocation)-/i.test(raw) || /^(?:task|work|invocation):/i.test(raw)) return [];
    const candidate = describedFileCandidate(raw);
    if (!/[\\/]/.test(candidate) && !/\.[a-z0-9]{1,10}$/i.test(candidate)) return [];
    const ref = normalizeProjectRelativePath(root, candidate);
    return ref ? [{ ref }] : [];
  });
}

function classify(ref: string, sourceKind?: string): ProjectArtifactLedgerKind {
  if (sourceKind === 'pull_request' || /(?:github\.com\/.+\/pull\/|\bpull[_ -]?request\b)/i.test(ref)) return 'pull_request';
  if (sourceKind === 'review') return 'review';
  if (sourceKind === 'proof' || sourceKind === 'log') return 'proof';
  if (sourceKind === 'test') return 'test';
  if (sourceKind === 'doc') return 'document';
  if (sourceKind === 'design') return 'design';
  if (sourceKind === 'url') return 'link';
  if (sourceKind === 'merge') return 'pull_request';
  if (/^https?:\/\//i.test(ref)) return 'link';
  if (/(^|\/)(?:test|tests|__tests__)(\/|$)|\.(?:spec|test)\.[^.]+$/i.test(ref)) return 'test';
  if (/(^|\/)(?:docs|specs|design|architecture)\/|\.(?:md|mdx|pdf|docx?)$/i.test(ref)) return 'document';
  if (/\.(?:png|jpe?g|gif|webp|svg|fig|pen|sketch)$/i.test(ref)) return 'design';
  if (/\.(?:[cm]?[jt]sx?|html?|py|rs|go|java|kt|swift|rb|php|vue|svelte|css|scss|sql|sh|ps1)$/i.test(ref)) return 'code';
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

function registeredProducerRank(actionType: string | null): number {
  if (actionType === 'task.review_requested' || actionType === 'task.pull_request_submitted') return 3;
  if (
    actionType === 'task.provider_review_received'
    || actionType === 'task.review_recorded'
    || actionType === 'task.pull_request_merged'
    || actionType === 'task.merge_requested'
    || actionType === 'task.merged'
  ) return 1;
  return 2;
}

function merge(items: ArtifactProjectionItem[], limit: number): ProjectArtifactLedgerItem[] {
  const byRef = new Map<string, ArtifactProjectionItem>();
  for (const item of items.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))) {
    const key = item.ref.toLocaleLowerCase('en-US');
    const prior = byRef.get(key);
    const keepProducer = Boolean(prior && prior.producerRank > item.producerRank);
    const merged: ArtifactProjectionItem = prior ? {
      ...prior,
      ...item,
      producerRank: keepProducer ? prior.producerRank : item.producerRank,
      status: prior.status === 'registered' || item.status === 'registered' ? 'registered' : 'working',
      operations: [...new Set([...prior.operations, ...item.operations])],
      ...(item.workId
        ? { workId: item.workId, workTitle: item.workTitle }
        : prior.workId
          ? { workId: prior.workId, workTitle: prior.workTitle }
          : {}),
    } : item;
    if (prior && keepProducer) {
      merged.updatedBy = prior.updatedBy;
      if (prior.invocationId) merged.invocationId = prior.invocationId;
      else delete merged.invocationId;
      if (prior.workId) {
        merged.workId = prior.workId;
        merged.workTitle = prior.workTitle;
      } else {
        delete merged.workId;
        delete merged.workTitle;
      }
    }
    byRef.set(key, merged);
  }
  return [...byRef.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map(({ producerRank, conversationId, ...item }) => {
      void producerRank;
      void conversationId;
      return item;
    });
}

function isFormalArtifact(item: ArtifactProjectionItem): boolean {
  return item.kind !== 'proof'
    && !/^(?:cmd|test|trace|proof|live-db|disk|e2e):/i.test(item.ref.trim());
}

export const projectArtifactLedger = {
  list(projectId: string, limit = 100, scope?: ArtifactLedgerScope): ProjectArtifactLedgerItem[] {
    const project = projectRepo.getById(projectId);
    if (!project) throw new Error('artifact_project_not_found');
    const registeredRows = getDb().prepare(`
      SELECT artifact.id,artifact.conversation_id,artifact.task_id,artifact.kind,artifact.label,artifact.path,artifact.url,
        artifact.proof_event_id,artifact.created_at,action.actor_id,action.type AS action_type,
        task.title AS task_title
      FROM task_artifact_ref artifact
      JOIN conversation ON conversation.id=artifact.conversation_id
      LEFT JOIN task_action action ON action.id=artifact.created_by_action_id
      LEFT JOIN task ON task.id=artifact.task_id
      WHERE conversation.project_id=?
      ORDER BY artifact.created_at DESC,artifact.id DESC
      LIMIT 500
    `).all(projectId) as RegisteredArtifactRow[];
    const registered = registeredRows.flatMap((row): ArtifactProjectionItem[] => {
      const rawRef = row.url ?? row.path ?? row.label;
      const parsed = outcomeEvidence(project.root_path, rawRef);
      const evidence = parsed.length > 0
        ? parsed
        : !/^file:/i.test(rawRef) && (row.kind === 'proof' || row.kind === 'log' || row.kind === 'test')
          ? [{ ref: rawRef, kind: classify(rawRef, row.kind) }]
          : [];
      return evidence.map(({ ref, kind }) => ({
        id: evidence.length === 1
          ? row.id
          : hashId(`registered:${row.id}:${ref.toLocaleLowerCase('en-US')}`),
        projectId,
        ref,
        label: label(ref),
        kind: kind ?? classify(ref, row.kind),
        status: 'registered',
        updatedAt: row.created_at,
        updatedBy: row.actor_id ?? 'system',
        producerRank: registeredProducerRank(row.action_type),
        conversationId: row.conversation_id,
        operations: ['register'],
        workId: row.task_id,
        ...(row.task_title ? { workTitle: row.task_title } : {}),
        ...(row.proof_event_id ? { proofEventId: row.proof_event_id } : {}),
      }));
    });

    const outcomeRows = getDb().prepare(`
      SELECT outcome.id,outcome.project_id AS conversation_id,outcome.work_id,outcome.outcome_type,outcome.evidence_refs_json,outcome.recorded_at,
        contract.agent_id,contract.task_id,task.title AS task_title,contract.goal
      FROM agent_outcome outcome
      JOIN work_contract contract ON contract.id=outcome.contract_id
      JOIN conversation ON conversation.id=outcome.project_id
      LEFT JOIN task ON task.id=contract.task_id
      WHERE conversation.project_id=?
        AND outcome.admission_status='accepted'
        AND outcome.outcome_type IN ('submit_task_result','request_review','record_gate_decision')
      ORDER BY outcome.recorded_at DESC,outcome.id DESC
      LIMIT 500
    `).all(projectId) as OutcomeEvidenceRow[];
    const outcomeEvidenceItems = outcomeRows.flatMap((row): ArtifactProjectionItem[] => {
      let refs: unknown;
      try { refs = JSON.parse(row.evidence_refs_json); } catch { refs = []; }
      if (!Array.isArray(refs)) return [];
      return refs.flatMap((value): ArtifactProjectionItem[] => {
        if (typeof value !== 'string') return [];
        return outcomeEvidence(project.root_path, value).map((evidence) => ({
          id: hashId(`outcome:${projectId}:${row.id}:${evidence.ref.toLocaleLowerCase('en-US')}`),
          projectId,
          ref: evidence.ref,
          label: label(evidence.ref),
          kind: evidence.kind ?? classify(evidence.ref),
          status: 'registered',
          updatedAt: row.recorded_at,
          updatedBy: row.agent_id,
          producerRank: row.outcome_type === 'record_gate_decision' ? 1 : row.task_id ? 3 : 2,
          conversationId: row.conversation_id,
          operations: ['register'],
          workId: row.task_id ?? row.work_id,
          workTitle: workTitle(row.task_title, row.goal),
          proofEventId: row.id,
        }));
      });
    });

    const runtimeRows = getDb().prepare(`
      SELECT event.type,event.project_id AS conversation_id,event.payload,event.recorded_at,event.invocation_id,
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
    const observed: ArtifactProjectionItem[] = [];
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
          producerRank: 4,
          conversationId: row.conversation_id,
          operations: [operation(toolName)],
          ...(row.task_id ? { workId: row.task_id } : {}),
          ...(row.task_title ? { workTitle: row.task_title } : {}),
          ...(row.invocation_id ? { invocationId: row.invocation_id } : {}),
        });
      }
    }
    const scopeWorkIds = new Set(scope?.workIds ?? []);
    const scopedItems = [...observed, ...registered, ...outcomeEvidenceItems].filter((item) => (
      !scope
      || (scope.conversationId && item.conversationId === scope.conversationId)
      || (item.workId && scopeWorkIds.has(item.workId))
    ));
    return merge(
      scopedItems.filter(isFormalArtifact),
      limit,
    );
  },

  listAll(limit = 500): ProjectArtifactLedgerItem[] {
    return projectRepo.list()
      .flatMap((project) => projectArtifactLedger.list(project.id, 200))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, Math.max(1, Math.min(1_000, limit)));
  },
};
