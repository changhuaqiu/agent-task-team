import { createHash } from 'node:crypto';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';

export const TEAM_MEMORY_KINDS = [
  'decision',
  'fact',
  'lesson',
  'correction',
  'open_loop',
  'relationship',
] as const;
export type TeamMemoryKind = (typeof TEAM_MEMORY_KINDS)[number];

export const MEMORY_DISPOSITIONS = ['propose', 'defer', 'abstain'] as const;
export type MemoryDisposition = (typeof MEMORY_DISPOSITIONS)[number];

export const MEMORY_RELATION_KINDS = [
  'handoff',
  'review',
  'expertise',
  'communication',
] as const;
export type MemoryRelationKind = (typeof MEMORY_RELATION_KINDS)[number];

export interface TeamMemoryItemRow {
  id: string;
  idempotency_key: string;
  conversation_id: string;
  task_id: string | null;
  scope_kind: 'project' | 'task' | 'agent';
  visibility: 'team' | 'agent';
  owner_agent_id: string | null;
  kind: TeamMemoryKind;
  content: string;
  status: 'proposed' | 'accepted' | 'superseded' | 'retired';
  subject_agent_id: string | null;
  object_agent_id: string | null;
  relation_kind: MemoryRelationKind | null;
  source_refs_json: string;
  proposer_agent_id: string;
  accepted_by: string | null;
  supersedes_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}

export interface MemoryOpportunityRow {
  id: string;
  idempotency_key: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  kind_hint: TeamMemoryKind | null;
  source_refs_json: string;
  disposition: 'deferred' | 'proposed' | 'abstained';
  reason_code: string | null;
  resolved_memory_id: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface TeamMemoryRelationshipSummary {
  otherAgentId: string;
  handoffCount: number;
  completedHandoffCount: number;
  reviewCount: number;
  lastObservedAt: string;
  evidenceRefs: string[];
}

export interface TeamMemoryRecallResult {
  items: TeamMemoryItemRow[];
  deferred: MemoryOpportunityRow[];
  relationships: TeamMemoryRelationshipSummary[];
}

export interface RecordMemoryInput {
  conversationId: string;
  taskId?: string;
  agentId: string;
  idempotencyKey: string;
  disposition: MemoryDisposition;
  opportunityId?: string;
  kind?: TeamMemoryKind;
  content?: string;
  scope?: 'project' | 'task' | 'agent';
  visibility?: 'team' | 'agent';
  sourceRefs?: string[];
  reasonCode?: string;
  supersedesId?: string;
  relationship?: {
    subjectAgentId: string;
    objectAgentId: string;
    relationKind: MemoryRelationKind;
  };
}

export interface ObserveMemoryInput {
  conversationId: string;
  taskId?: string;
  agentId: string;
  idempotencyKey: string;
  sourceRefs: string[];
  reasonCode: string;
  kindHint?: TeamMemoryKind;
}

export interface RecallMemoryInput {
  conversationId: string;
  taskId?: string;
  agentId: string;
  query?: string;
  limit?: number;
}

export interface DecideMemoryInput {
  memoryId: string;
  expectedRevision: number;
  decision: 'accept' | 'retire';
  actor: { type: 'human' | 'system'; id: string };
  reasonCode: string;
}

export type MemoryRecordResult = {
  opportunity: MemoryOpportunityRow;
  memory?: TeamMemoryItemRow;
  replayed: boolean;
};

type ResolvedSource = {
  ref: string;
  kind: 'task' | 'proof' | 'task-action' | 'a2a-pass' | 'message';
  relationshipPair?: { subjectAgentId: string; objectAgentId: string; relationKind: 'handoff' | 'review' };
};

export class TeamMemoryError extends Error {
  constructor(readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'TeamMemoryError';
  }
}

function requiredText(value: string | undefined, field: string, max = 2_000): string {
  const text = value?.trim();
  if (!text) throw new TeamMemoryError('memory_input_invalid', `${field} is required`);
  if (text.length > max) throw new TeamMemoryError('memory_input_invalid', `${field} exceeds ${max} characters`);
  return text;
}

function parseRefs(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function canonicalRefs(refs: string[] | undefined): string[] {
  const normalized = [...new Set((refs ?? []).map((ref) => ref.trim()).filter(Boolean))].sort();
  if (normalized.length > 20 || normalized.some((ref) => ref.length > 500)) {
    throw new TeamMemoryError('memory_source_invalid', 'sourceRefs must contain at most 20 bounded references');
  }
  return normalized;
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function event(input: {
  conversationId: string;
  memoryId?: string;
  opportunityId?: string;
  eventType: string;
  actor: { type: 'agent' | 'human' | 'system'; id: string };
  reasonCode?: string;
  metadata?: Record<string, unknown>;
  now: string;
}): void {
  getDb().prepare(`
    INSERT INTO team_memory_event (
      id,conversation_id,memory_id,opportunity_id,event_type,actor_type,actor_id,
      reason_code,metadata_json,created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    generateSortableId('memory-event'),
    input.conversationId,
    input.memoryId ?? null,
    input.opportunityId ?? null,
    input.eventType,
    input.actor.type,
    input.actor.id,
    input.reasonCode ?? null,
    JSON.stringify(input.metadata ?? {}),
    input.now,
  );
}

function getOpportunity(id: string): MemoryOpportunityRow | undefined {
  return getDb().prepare('SELECT * FROM team_memory_opportunity WHERE id=?')
    .get(id) as MemoryOpportunityRow | undefined;
}

function getMemory(id: string): TeamMemoryItemRow | undefined {
  return getDb().prepare('SELECT * FROM team_memory_item WHERE id=?')
    .get(id) as TeamMemoryItemRow | undefined;
}

function assertTaskScope(conversationId: string, taskId: string | undefined): void {
  if (!taskId) return;
  const task = getDb().prepare('SELECT conversation_id FROM task WHERE id=?')
    .get(taskId) as { conversation_id: string } | undefined;
  if (!task || task.conversation_id !== conversationId) {
    throw new TeamMemoryError('memory_task_scope_mismatch', `Task ${taskId} is not in the current conversation`);
  }
}

function resolveSources(conversationId: string, refs: string[]): ResolvedSource[] {
  const db = getDb();
  return refs.map((ref) => {
    const separator = ref.indexOf(':');
    if (separator <= 0 || separator === ref.length - 1) {
      throw new TeamMemoryError('memory_source_invalid', `Unsupported memory source: ${ref}`);
    }
    const kind = ref.slice(0, separator);
    const id = ref.slice(separator + 1);
    if (kind === 'task') {
      const row = db.prepare('SELECT conversation_id FROM task WHERE id=?').get(id) as { conversation_id: string } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return { ref, kind };
    }
    if (kind === 'proof') {
      const row = db.prepare('SELECT conversation_id FROM control_proof_event WHERE id=?').get(id) as { conversation_id: string | null } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return { ref, kind };
    }
    if (kind === 'task-action') {
      const row = db.prepare(`
        SELECT conversation_id,actor_id,type,task_ids FROM task_action WHERE id=?
      `).get(id) as { conversation_id: string; actor_id: string; type: string; task_ids: string } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      let relationshipPair: ResolvedSource['relationshipPair'];
      if (row.type === 'task.provider_review_received') {
        const taskIds = parseRefs(row.task_ids);
        const task = taskIds.length === 1
          ? db.prepare('SELECT agent_id FROM task WHERE id=? AND conversation_id=?')
            .get(taskIds[0], conversationId) as { agent_id: string } | undefined
          : undefined;
        if (task?.agent_id) {
          relationshipPair = {
            subjectAgentId: row.actor_id,
            objectAgentId: task.agent_id,
            relationKind: 'review',
          };
        }
      }
      return { ref, kind, relationshipPair };
    }
    if (kind === 'a2a-pass') {
      const row = db.prepare(`
        SELECT chain.conversation_id,pass.from_holder_id,pass.to_agent_id,pass.status
        FROM a2a_pass pass
        JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
        WHERE pass.id=?
      `).get(id) as {
        conversation_id: string;
        from_holder_id: string;
        to_agent_id: string;
        status: string;
      } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return {
        ref,
        kind,
        relationshipPair: row.status === 'completed' ? {
          subjectAgentId: row.from_holder_id,
          objectAgentId: row.to_agent_id,
          relationKind: 'handoff',
        } : undefined,
      };
    }
    if (kind === 'message') {
      const row = db.prepare('SELECT conversation_id FROM chat_message WHERE id=?').get(id) as { conversation_id: string } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return { ref, kind };
    }
    throw new TeamMemoryError('memory_source_invalid', `Unsupported memory source kind: ${kind}`);
  });
}

function relationshipIsBound(
  relationship: NonNullable<RecordMemoryInput['relationship']>,
  sources: ResolvedSource[],
): boolean {
  return sources.some((source) => source.relationshipPair
    && source.relationshipPair.relationKind === relationship.relationKind
    && source.relationshipPair.subjectAgentId === relationship.subjectAgentId
    && source.relationshipPair.objectAgentId === relationship.objectAgentId);
}

function acceptanceDecision(input: {
  kind: TeamMemoryKind;
  sources: ResolvedSource[];
  relationship?: NonNullable<RecordMemoryInput['relationship']>;
}): { accepted: boolean; acceptedBy?: string; reason: string } {
  const strongSource = input.sources.some((source) => (
    source.kind === 'proof' || source.kind === 'task-action' || source.kind === 'a2a-pass'
  ));
  if (!strongSource) return { accepted: false, reason: 'strong_source_required' };
  if (input.kind === 'correction') return { accepted: false, reason: 'human_governance_required' };
  if (input.kind === 'relationship') {
    if (!input.relationship || !relationshipIsBound(input.relationship, input.sources)) {
      return { accepted: false, reason: 'relationship_evidence_unbound' };
    }
  }
  return { accepted: true, acceptedBy: 'system:evidence-gate-v1', reason: 'evidence_gate_passed' };
}

function queryTerms(value: string | undefined): string | undefined {
  const normalized = value?.normalize('NFKC').trim();
  if (!normalized) return undefined;
  const words = normalized.match(/[\p{L}\p{N}_-]{2,48}/gu) ?? [];
  const unique = [...new Set(words.map((word) => word.toLocaleLowerCase()))].slice(0, 8);
  if (unique.length === 0) return undefined;
  return unique.map((word) => `"${word.replaceAll('"', '""')}"`).join(' OR ');
}

function stableDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export class TeamMemory {
  observe(input: ObserveMemoryInput): MemoryOpportunityRow {
    requiredText(input.conversationId, 'conversationId', 200);
    requiredText(input.agentId, 'agentId', 200);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    const reasonCode = requiredText(input.reasonCode, 'reasonCode', 200);
    const sourceRefs = canonicalRefs(input.sourceRefs);
    if (sourceRefs.length === 0) throw new TeamMemoryError('memory_source_required', 'observe requires source refs');
    assertTaskScope(input.conversationId, input.taskId);
    resolveSources(input.conversationId, sourceRefs);
    const db = getDb();
    const duplicate = db.prepare(`
      SELECT * FROM team_memory_opportunity WHERE conversation_id=? AND idempotency_key=?
    `).get(input.conversationId, idempotencyKey) as MemoryOpportunityRow | undefined;
    if (duplicate) {
      if (
        duplicate.agent_id !== input.agentId
        || duplicate.task_id !== (input.taskId ?? null)
        || duplicate.reason_code !== reasonCode
        || !sameStringArray(parseRefs(duplicate.source_refs_json), sourceRefs)
      ) throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
      return duplicate;
    }
    const now = new Date().toISOString();
    const id = generateSortableId('memory-opportunity');
    db.transaction(() => {
      db.prepare(`
        INSERT INTO team_memory_opportunity (
          id,idempotency_key,conversation_id,task_id,agent_id,kind_hint,
          source_refs_json,disposition,reason_code,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,'deferred',?,?,?)
      `).run(
        id,
        idempotencyKey,
        input.conversationId,
        input.taskId ?? null,
        input.agentId,
        input.kindHint ?? null,
        JSON.stringify(sourceRefs),
        reasonCode,
        now,
        now,
      );
      event({
        conversationId: input.conversationId,
        opportunityId: id,
        eventType: 'memory.opportunity.deferred',
        actor: { type: 'system', id: 'team-memory-observer' },
        reasonCode,
        metadata: { sourceDigest: stableDigest(sourceRefs) },
        now,
      });
    }).immediate();
    return getOpportunity(id)!;
  }

  record(input: RecordMemoryInput): MemoryRecordResult {
    requiredText(input.conversationId, 'conversationId', 200);
    requiredText(input.agentId, 'agentId', 200);
    const idempotencyKey = requiredText(input.idempotencyKey, 'idempotencyKey', 500);
    if (!MEMORY_DISPOSITIONS.includes(input.disposition)) {
      throw new TeamMemoryError('memory_input_invalid', 'Unsupported disposition');
    }
    assertTaskScope(input.conversationId, input.taskId);
    const existingItem = getDb().prepare(`
      SELECT * FROM team_memory_item WHERE conversation_id=? AND idempotency_key=?
    `).get(input.conversationId, idempotencyKey) as TeamMemoryItemRow | undefined;
    if (existingItem) {
      if (
        input.disposition !== 'propose'
        || existingItem.proposer_agent_id !== input.agentId
        || existingItem.kind !== input.kind
        || existingItem.content !== input.content?.trim()
      ) throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
      const opportunity = getDb().prepare(`
        SELECT * FROM team_memory_opportunity WHERE resolved_memory_id=?
      `).get(existingItem.id) as MemoryOpportunityRow;
      return { opportunity, memory: existingItem, replayed: true };
    }

    const pending = input.opportunityId ? getOpportunity(input.opportunityId) : undefined;
    if (input.opportunityId && (
      !pending
      || pending.conversation_id !== input.conversationId
      || pending.agent_id !== input.agentId
      || pending.disposition !== 'deferred'
    )) throw new TeamMemoryError('memory_opportunity_unavailable', input.opportunityId);
    const sourceRefs = pending
      ? parseRefs(pending.source_refs_json)
      : canonicalRefs(input.sourceRefs);
    if (input.sourceRefs && pending && !sameStringArray(canonicalRefs(input.sourceRefs), sourceRefs)) {
      throw new TeamMemoryError('memory_source_mismatch', 'Deferred opportunity sources are immutable');
    }
    const sources = resolveSources(input.conversationId, sourceRefs);
    const now = new Date().toISOString();
    const db = getDb();

    if (input.disposition === 'defer') {
      if (input.content?.trim()) throw new TeamMemoryError('memory_input_invalid', 'defer cannot store content');
      const opportunity = pending ?? this.observe({
        conversationId: input.conversationId,
        taskId: input.taskId,
        agentId: input.agentId,
        idempotencyKey,
        sourceRefs,
        reasonCode: input.reasonCode ?? 'agent_deferred',
        kindHint: input.kind,
      });
      return { opportunity, replayed: Boolean(pending) };
    }

    if (input.disposition === 'abstain') {
      if (input.content?.trim()) throw new TeamMemoryError('memory_input_invalid', 'abstain cannot store content');
      const opportunityId = pending?.id ?? generateSortableId('memory-opportunity');
      db.transaction(() => {
        if (pending) {
          db.prepare(`
            UPDATE team_memory_opportunity
            SET disposition='abstained',reason_code=?,updated_at=?,resolved_at=?
            WHERE id=? AND disposition='deferred'
          `).run(input.reasonCode ?? 'agent_abstained', now, now, pending.id);
        } else {
          db.prepare(`
            INSERT INTO team_memory_opportunity (
              id,idempotency_key,conversation_id,task_id,agent_id,kind_hint,
              source_refs_json,disposition,reason_code,created_at,updated_at,resolved_at
            ) VALUES (?,?,?,?,?,?,?,'abstained',?,?,?,?)
          `).run(
            opportunityId,
            idempotencyKey,
            input.conversationId,
            input.taskId ?? null,
            input.agentId,
            input.kind ?? null,
            JSON.stringify(sourceRefs),
            input.reasonCode ?? 'agent_abstained',
            now,
            now,
            now,
          );
        }
        event({
          conversationId: input.conversationId,
          opportunityId,
          eventType: 'memory.opportunity.abstained',
          actor: { type: 'agent', id: input.agentId },
          reasonCode: input.reasonCode ?? 'agent_abstained',
          now,
        });
      }).immediate();
      return { opportunity: getOpportunity(opportunityId)!, replayed: false };
    }

    const kind = input.kind;
    if (!kind || !TEAM_MEMORY_KINDS.includes(kind)) {
      throw new TeamMemoryError('memory_input_invalid', 'kind is required for propose');
    }
    const content = requiredText(input.content, 'content');
    if (sourceRefs.length === 0) throw new TeamMemoryError('memory_source_required', 'propose requires source refs');
    const scope = input.scope ?? (input.taskId ? 'task' : 'project');
    const visibility = input.visibility ?? (scope === 'agent' ? 'agent' : 'team');
    if (scope === 'task' && !input.taskId) throw new TeamMemoryError('memory_task_required', 'task scope requires taskId');
    if (scope === 'agent' && visibility !== 'agent') {
      throw new TeamMemoryError('memory_visibility_invalid', 'agent scope must be agent-private');
    }
    if (kind === 'relationship') {
      if (!input.relationship) throw new TeamMemoryError('memory_relationship_invalid', 'relationship coordinates are required');
      if (
        !requiredText(input.relationship.subjectAgentId, 'subjectAgentId', 200)
        || !requiredText(input.relationship.objectAgentId, 'objectAgentId', 200)
        || input.relationship.subjectAgentId === input.relationship.objectAgentId
        || !MEMORY_RELATION_KINDS.includes(input.relationship.relationKind)
      ) throw new TeamMemoryError('memory_relationship_invalid', 'Agent relationship is invalid');
    } else if (input.relationship) {
      throw new TeamMemoryError('memory_relationship_invalid', 'relationship coordinates require relationship kind');
    }
    if (input.supersedesId) {
      const superseded = getMemory(input.supersedesId);
      if (!superseded || superseded.conversation_id !== input.conversationId) {
        throw new TeamMemoryError('memory_supersedes_invalid', input.supersedesId);
      }
    }
    const admission = acceptanceDecision({ kind, sources, relationship: input.relationship });
    const memoryId = generateSortableId('memory');
    const opportunityId = pending?.id ?? generateSortableId('memory-opportunity');
    db.transaction(() => {
      db.prepare(`
        INSERT INTO team_memory_item (
          id,idempotency_key,conversation_id,task_id,scope_kind,visibility,
          owner_agent_id,kind,content,status,subject_agent_id,object_agent_id,
          relation_kind,source_refs_json,proposer_agent_id,accepted_by,
          supersedes_id,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        memoryId,
        idempotencyKey,
        input.conversationId,
        input.taskId ?? null,
        scope,
        visibility,
        visibility === 'agent' ? input.agentId : null,
        kind,
        content,
        admission.accepted ? 'accepted' : 'proposed',
        input.relationship?.subjectAgentId ?? null,
        input.relationship?.objectAgentId ?? null,
        input.relationship?.relationKind ?? null,
        JSON.stringify(sourceRefs),
        input.agentId,
        admission.acceptedBy ?? null,
        input.supersedesId ?? null,
        now,
        now,
      );
      if (pending) {
        db.prepare(`
          UPDATE team_memory_opportunity
          SET disposition='proposed',resolved_memory_id=?,reason_code=?,updated_at=?,resolved_at=?
          WHERE id=? AND disposition='deferred'
        `).run(memoryId, admission.reason, now, now, pending.id);
      } else {
        db.prepare(`
          INSERT INTO team_memory_opportunity (
            id,idempotency_key,conversation_id,task_id,agent_id,kind_hint,
            source_refs_json,disposition,reason_code,resolved_memory_id,
            created_at,updated_at,resolved_at
          ) VALUES (?,?,?,?,?,?,?,'proposed',?,?,?, ?,?)
        `).run(
          opportunityId,
          `proposal:${idempotencyKey}`,
          input.conversationId,
          input.taskId ?? null,
          input.agentId,
          kind,
          JSON.stringify(sourceRefs),
          admission.reason,
          memoryId,
          now,
          now,
          now,
        );
      }
      if (admission.accepted && input.supersedesId) {
        db.prepare(`
          UPDATE team_memory_item
          SET status='superseded',revision=revision+1,updated_at=?
          WHERE id=? AND conversation_id=? AND status='accepted'
        `).run(now, input.supersedesId, input.conversationId);
      }
      event({
        conversationId: input.conversationId,
        memoryId,
        opportunityId,
        eventType: admission.accepted ? 'memory.accepted' : 'memory.proposed',
        actor: { type: 'agent', id: input.agentId },
        reasonCode: admission.reason,
        metadata: { sourceDigest: stableDigest(sourceRefs) },
        now,
      });
    }).immediate();
    return { opportunity: getOpportunity(opportunityId)!, memory: getMemory(memoryId)!, replayed: false };
  }

  decide(input: DecideMemoryInput): TeamMemoryItemRow {
    const memory = getMemory(input.memoryId);
    if (!memory) throw new TeamMemoryError('memory_not_found', input.memoryId);
    if (memory.revision !== input.expectedRevision) {
      throw new TeamMemoryError('memory_revision_stale', input.memoryId);
    }
    const nextStatus = input.decision === 'accept' ? 'accepted' : 'retired';
    if (input.decision === 'accept' && memory.status !== 'proposed') {
      throw new TeamMemoryError('memory_transition_invalid', `${memory.status} -> accepted`);
    }
    if (input.decision === 'retire' && !['proposed', 'accepted'].includes(memory.status)) {
      throw new TeamMemoryError('memory_transition_invalid', `${memory.status} -> retired`);
    }
    const now = new Date().toISOString();
    const result = getDb().transaction(() => {
      const updated = getDb().prepare(`
        UPDATE team_memory_item
        SET status=?,accepted_by=CASE WHEN ?='accepted' THEN ? ELSE accepted_by END,
            revision=revision+1,updated_at=?,retired_at=CASE WHEN ?='retired' THEN ? ELSE NULL END
        WHERE id=? AND revision=?
      `).run(nextStatus, nextStatus, `${input.actor.type}:${input.actor.id}`, now, nextStatus, now, input.memoryId, input.expectedRevision);
      if (updated.changes !== 1) throw new TeamMemoryError('memory_revision_stale', input.memoryId);
      event({
        conversationId: memory.conversation_id,
        memoryId: memory.id,
        eventType: nextStatus === 'accepted' ? 'memory.accepted' : 'memory.retired',
        actor: input.actor,
        reasonCode: requiredText(input.reasonCode, 'reasonCode', 200),
        now,
      });
      return getMemory(input.memoryId)!;
    }).immediate();
    return result;
  }

  recall(input: RecallMemoryInput): TeamMemoryRecallResult {
    requiredText(input.conversationId, 'conversationId', 200);
    requiredText(input.agentId, 'agentId', 200);
    assertTaskScope(input.conversationId, input.taskId);
    const limit = Math.max(1, Math.min(input.limit ?? 5, 10));
    const db = getDb();
    let items: TeamMemoryItemRow[] = [];
    const ftsQuery = queryTerms(input.query);
    if (ftsQuery) {
      try {
        items = db.prepare(`
          SELECT memory.*
          FROM team_memory_fts fts
          JOIN team_memory_item memory ON memory.id=fts.memory_id
          WHERE team_memory_fts MATCH ?
            AND memory.conversation_id=? AND memory.status='accepted'
            AND (memory.visibility='team' OR memory.owner_agent_id=?)
            AND (memory.scope_kind<>'task' OR memory.task_id=?)
          ORDER BY bm25(team_memory_fts),memory.updated_at DESC,memory.id DESC
          LIMIT ?
        `).all(
          ftsQuery,
          input.conversationId,
          input.agentId,
          input.taskId ?? null,
          limit,
        ) as TeamMemoryItemRow[];
      } catch {
        items = [];
      }
    }
    if (items.length < limit) {
      const existingIds = new Set(items.map((item) => item.id));
      const recent = db.prepare(`
        SELECT * FROM team_memory_item
        WHERE conversation_id=? AND status='accepted'
          AND (visibility='team' OR owner_agent_id=?)
          AND (scope_kind<>'task' OR task_id=?)
        ORDER BY CASE WHEN task_id=? THEN 0 ELSE 1 END,updated_at DESC,id DESC
        LIMIT ?
      `).all(
        input.conversationId,
        input.agentId,
        input.taskId ?? null,
        input.taskId ?? null,
        limit,
      ) as TeamMemoryItemRow[];
      items.push(...recent.filter((item) => !existingIds.has(item.id)).slice(0, limit - items.length));
    }
    const deferred = db.prepare(`
      SELECT * FROM team_memory_opportunity
      WHERE conversation_id=? AND agent_id=? AND disposition='deferred'
        AND (task_id IS NULL OR task_id=?)
      ORDER BY updated_at ASC,id ASC LIMIT 2
    `).all(
      input.conversationId,
      input.agentId,
      input.taskId ?? null,
    ) as MemoryOpportunityRow[];
    return {
      items: items.slice(0, limit),
      deferred,
      relationships: this.relationships(input.conversationId, input.agentId),
    };
  }

  private relationships(conversationId: string, agentId: string): TeamMemoryRelationshipSummary[] {
    const db = getDb();
    const summaries = new Map<string, TeamMemoryRelationshipSummary>();
    const ensure = (otherAgentId: string, observedAt: string) => {
      const current = summaries.get(otherAgentId) ?? {
        otherAgentId,
        handoffCount: 0,
        completedHandoffCount: 0,
        reviewCount: 0,
        lastObservedAt: observedAt,
        evidenceRefs: [],
      };
      if (observedAt > current.lastObservedAt) current.lastObservedAt = observedAt;
      summaries.set(otherAgentId, current);
      return current;
    };
    const passes = db.prepare(`
      SELECT pass.id,pass.from_holder_id,pass.to_agent_id,pass.status,pass.updated_at
      FROM a2a_pass pass
      JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
      WHERE chain.conversation_id=?
        AND (pass.from_holder_id=? OR pass.to_agent_id=?)
      ORDER BY pass.updated_at DESC,pass.id DESC LIMIT 50
    `).all(conversationId, agentId, agentId) as Array<{
      id: string;
      from_holder_id: string;
      to_agent_id: string;
      status: string;
      updated_at: string;
    }>;
    for (const pass of passes) {
      const other = pass.from_holder_id === agentId ? pass.to_agent_id : pass.from_holder_id;
      if (!other || other === agentId) continue;
      const summary = ensure(other, pass.updated_at);
      summary.handoffCount += 1;
      if (pass.status === 'completed') summary.completedHandoffCount += 1;
      if (summary.evidenceRefs.length < 3) summary.evidenceRefs.push(`a2a-pass:${pass.id}`);
    }
    const reviews = db.prepare(`
      SELECT action.id,action.actor_id,action.task_ids,action.created_at
      FROM task_action action
      WHERE action.conversation_id=? AND action.type='task.provider_review_received'
      ORDER BY action.created_at DESC,action.id DESC LIMIT 50
    `).all(conversationId) as Array<{
      id: string;
      actor_id: string;
      task_ids: string;
      created_at: string;
    }>;
    for (const review of reviews) {
      const taskIds = parseRefs(review.task_ids);
      if (taskIds.length !== 1) continue;
      const task = db.prepare('SELECT agent_id FROM task WHERE id=? AND conversation_id=?')
        .get(taskIds[0], conversationId) as { agent_id: string } | undefined;
      if (!task || (review.actor_id !== agentId && task.agent_id !== agentId)) continue;
      const other = review.actor_id === agentId ? task.agent_id : review.actor_id;
      if (!other || other === agentId) continue;
      const summary = ensure(other, review.created_at);
      summary.reviewCount += 1;
      if (summary.evidenceRefs.length < 3) summary.evidenceRefs.push(`task-action:${review.id}`);
    }
    return [...summaries.values()]
      .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt))
      .slice(0, 5);
  }
}

export const teamMemory = new TeamMemory();
