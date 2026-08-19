import { createHash } from 'node:crypto';
import { getDb } from '../db';
import { resolveConversationRuntime } from '../invocation-pipeline/conversation-runtime';
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
  resolution_idempotency_key: string | null;
  resolution_digest: string | null;
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
  taskIds: string[];
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
      return { ref, kind, taskIds: [id] };
    }
    if (kind === 'proof') {
      const row = db.prepare('SELECT conversation_id,task_id FROM control_proof_event WHERE id=?').get(id) as { conversation_id: string | null; task_id: string | null } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return { ref, kind, taskIds: row.task_id ? [row.task_id] : [] };
    }
    if (kind === 'task-action') {
      const row = db.prepare(`
        SELECT conversation_id,actor_id,actor_type,type,task_ids FROM task_action WHERE id=?
      `).get(id) as { conversation_id: string; actor_id: string; actor_type: string; type: string; task_ids: string } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      const taskIds = parseRefs(row.task_ids);
      let relationshipPair: ResolvedSource['relationshipPair'];
      if (row.type === 'task.provider_review_received' && row.actor_type === 'agent') {
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
      return { ref, kind, taskIds, relationshipPair };
    }
    if (kind === 'a2a-pass') {
      const row = db.prepare(`
        SELECT chain.conversation_id,pass.from_holder_id,pass.to_agent_id,pass.status,
          source_possession.holder_type
        FROM a2a_pass pass
        JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
        JOIN a2a_possession source_possession ON source_possession.id=pass.from_possession_id
        WHERE pass.id=?
      `).get(id) as {
        conversation_id: string;
        from_holder_id: string;
        to_agent_id: string;
        status: string;
        holder_type: string;
      } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return {
        ref,
        kind,
        taskIds: [],
        relationshipPair: row.status === 'completed' && row.holder_type === 'agent' ? {
          subjectAgentId: row.from_holder_id,
          objectAgentId: row.to_agent_id,
          relationKind: 'handoff',
        } : undefined,
      };
    }
    if (kind === 'message') {
      const row = db.prepare('SELECT conversation_id,task_id FROM chat_message WHERE id=?').get(id) as { conversation_id: string; task_id: string | null } | undefined;
      if (row?.conversation_id !== conversationId) throw new TeamMemoryError('memory_source_scope_mismatch', ref);
      return { ref, kind, taskIds: row.task_id ? [row.task_id] : [] };
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

function assertRelationshipEndpointsAreAgents(
  conversationId: string,
  relationship: NonNullable<RecordMemoryInput['relationship']>,
  sources: ResolvedSource[],
): void {
  if (relationshipIsBound(relationship, sources)) return;
  const roster = new Set(
    (resolveConversationRuntime(conversationId)?.roster ?? []).map((agent) => agent.id),
  );
  if (!roster.has(relationship.subjectAgentId) || !roster.has(relationship.objectAgentId)) {
    throw new TeamMemoryError(
      'memory_relationship_endpoint_invalid',
      'Relationship memory is limited to authoritative Agent endpoints',
    );
  }
}

function acceptanceDecision(input: {
  kind: TeamMemoryKind;
  sources: ResolvedSource[];
  relationship?: NonNullable<RecordMemoryInput['relationship']>;
}): { accepted: boolean; reason: string } {
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
  return { accepted: true, reason: 'evidence_gate_passed' };
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

function assertSupersessionCompatible(
  replacement: TeamMemoryItemRow,
  predecessor: TeamMemoryItemRow,
): void {
  if (
    predecessor.conversation_id !== replacement.conversation_id
    || predecessor.status !== 'accepted'
    || predecessor.scope_kind !== replacement.scope_kind
    || predecessor.visibility !== replacement.visibility
    || predecessor.owner_agent_id !== replacement.owner_agent_id
    || (
      predecessor.kind !== replacement.kind
      && replacement.kind !== 'correction'
    )
    || (
      (predecessor.kind === 'relationship' || replacement.kind === 'relationship')
      && (
        predecessor.subject_agent_id !== replacement.subject_agent_id
        || predecessor.object_agent_id !== replacement.object_agent_id
        || predecessor.relation_kind !== replacement.relation_kind
      )
    )
  ) {
    throw new TeamMemoryError('memory_supersedes_invalid', predecessor.id);
  }
}

function acceptMemory(input: {
  memoryId: string;
  expectedRevision: number;
  actor: { type: 'human' | 'system'; id: string };
  reasonCode: string;
  now: string;
}): TeamMemoryItemRow {
  const memory = getMemory(input.memoryId);
  if (!memory || memory.status !== 'proposed' || memory.revision !== input.expectedRevision) {
    throw new TeamMemoryError('memory_revision_stale', input.memoryId);
  }
  if (memory.kind === 'relationship') {
    const relationship = {
      subjectAgentId: memory.subject_agent_id!,
      objectAgentId: memory.object_agent_id!,
      relationKind: memory.relation_kind!,
    };
    assertRelationshipEndpointsAreAgents(
      memory.conversation_id,
      relationship,
      resolveSources(memory.conversation_id, parseRefs(memory.source_refs_json)),
    );
  }
  if (memory.supersedes_id) {
    const predecessor = getMemory(memory.supersedes_id);
    if (!predecessor) throw new TeamMemoryError('memory_supersedes_invalid', memory.supersedes_id);
    assertSupersessionCompatible(memory, predecessor);
    const superseded = getDb().prepare(`
      UPDATE team_memory_item
      SET status='superseded',revision=revision+1,updated_at=?
      WHERE id=? AND revision=? AND status='accepted'
    `).run(input.now, predecessor.id, predecessor.revision);
    if (superseded.changes !== 1) {
      throw new TeamMemoryError('memory_supersedes_stale', predecessor.id);
    }
    event({
      conversationId: memory.conversation_id,
      memoryId: predecessor.id,
      eventType: 'memory.superseded',
      actor: input.actor,
      reasonCode: input.reasonCode,
      metadata: { replacementMemoryId: memory.id },
      now: input.now,
    });
  }
  const accepted = getDb().prepare(`
    UPDATE team_memory_item
    SET status='accepted',accepted_by=?,revision=revision+1,updated_at=?,retired_at=NULL
    WHERE id=? AND revision=? AND status='proposed'
  `).run(
    `${input.actor.type}:${input.actor.id}`,
    input.now,
    memory.id,
    input.expectedRevision,
  );
  if (accepted.changes !== 1) throw new TeamMemoryError('memory_revision_stale', memory.id);
  event({
    conversationId: memory.conversation_id,
    memoryId: memory.id,
    eventType: 'memory.accepted',
    actor: input.actor,
    reasonCode: input.reasonCode,
    now: input.now,
  });
  return getMemory(memory.id)!;
}

export class TeamMemory {
  observe(input: ObserveMemoryInput): MemoryOpportunityRow {
    return getDb().transaction(() => this.observeWithinTransaction(input)).immediate();
  }

  private observeWithinTransaction(input: ObserveMemoryInput): MemoryOpportunityRow {
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
        || duplicate.kind_hint !== (input.kindHint ?? null)
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
    return getDb().transaction(() => this.recordWithinTransaction(input)).immediate();
  }

  private recordWithinTransaction(input: RecordMemoryInput): MemoryRecordResult {
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
      const opportunity = getDb().prepare(`
        SELECT * FROM team_memory_opportunity WHERE resolved_memory_id=?
      `).get(existingItem.id) as MemoryOpportunityRow;
      const replayScope = input.scope ?? (input.taskId ? 'task' : 'project');
      const replayVisibility = input.visibility ?? (replayScope === 'agent' ? 'agent' : 'team');
      const replayRefs = input.opportunityId
        ? parseRefs(opportunity?.source_refs_json ?? '[]')
        : canonicalRefs(input.sourceRefs);
      if (
        input.disposition !== 'propose'
        || existingItem.proposer_agent_id !== input.agentId
        || existingItem.kind !== input.kind
        || existingItem.content !== input.content?.trim()
        || existingItem.task_id !== (input.taskId ?? null)
        || existingItem.scope_kind !== replayScope
        || existingItem.visibility !== replayVisibility
        || existingItem.supersedes_id !== (input.supersedesId ?? null)
        || existingItem.subject_agent_id !== (input.relationship?.subjectAgentId ?? null)
        || existingItem.object_agent_id !== (input.relationship?.objectAgentId ?? null)
        || existingItem.relation_kind !== (input.relationship?.relationKind ?? null)
        || !sameStringArray(parseRefs(existingItem.source_refs_json), replayRefs)
        || (input.opportunityId !== undefined && opportunity?.id !== input.opportunityId)
      ) throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
      return { opportunity, memory: existingItem, replayed: true };
    }

    const opportunity = input.opportunityId ? getOpportunity(input.opportunityId) : undefined;
    const sourceRefs = opportunity
      ? parseRefs(opportunity.source_refs_json)
      : canonicalRefs(input.sourceRefs);
    if (input.sourceRefs && opportunity && !sameStringArray(canonicalRefs(input.sourceRefs), sourceRefs)) {
      throw new TeamMemoryError('memory_source_mismatch', 'Deferred opportunity sources are immutable');
    }
    const resolutionDigest = stableDigest({
      conversationId: input.conversationId,
      taskId: input.taskId ?? null,
      agentId: input.agentId,
      disposition: input.disposition,
      opportunityId: input.opportunityId ?? null,
      kind: input.kind ?? null,
      content: input.content?.trim() ?? null,
      scope: input.scope ?? null,
      visibility: input.visibility ?? null,
      sourceRefs,
      reasonCode: input.reasonCode ?? null,
      supersedesId: input.supersedesId ?? null,
      relationship: input.relationship ?? null,
    });
    const keyedResolution = getDb().prepare(`
      SELECT * FROM team_memory_opportunity
      WHERE conversation_id=? AND resolution_idempotency_key=?
    `).get(input.conversationId, idempotencyKey) as MemoryOpportunityRow | undefined;
    const legacyDirectAbstain = !keyedResolution && !input.opportunityId
      ? getDb().prepare(`
          SELECT * FROM team_memory_opportunity
          WHERE conversation_id=? AND idempotency_key=?
            AND disposition='abstained' AND resolution_idempotency_key IS NULL
        `).get(input.conversationId, idempotencyKey) as MemoryOpportunityRow | undefined
      : undefined;
    const resolvedReplay = keyedResolution ?? legacyDirectAbstain ?? (
      opportunity && opportunity.disposition !== 'deferred'
        ? opportunity
        : undefined
    );
    if (resolvedReplay) {
      const legacyReplay = (
        resolvedReplay.resolution_digest === 'legacy:v85'
        || resolvedReplay.resolution_idempotency_key === null
      );
      if (legacyReplay) {
        const compatible = (
          input.disposition === 'abstain'
          && resolvedReplay.disposition === 'abstained'
          && resolvedReplay.conversation_id === input.conversationId
          && resolvedReplay.agent_id === input.agentId
          && resolvedReplay.task_id === (input.taskId ?? null)
          && (input.kind === undefined || resolvedReplay.kind_hint === input.kind)
          && resolvedReplay.reason_code === (input.reasonCode ?? 'agent_abstained')
          && !input.content?.trim()
          && sameStringArray(parseRefs(resolvedReplay.source_refs_json), sourceRefs)
          && (!input.opportunityId || input.opportunityId === resolvedReplay.id)
        );
        if (!compatible) throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
        const upgraded = getDb().prepare(`
          UPDATE team_memory_opportunity
          SET resolution_idempotency_key=?,resolution_digest=?
          WHERE id=? AND (
            resolution_digest='legacy:v85' OR resolution_idempotency_key IS NULL
          )
        `).run(idempotencyKey, resolutionDigest, resolvedReplay.id);
        if (upgraded.changes !== 1) {
          throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
        }
        return { opportunity: getOpportunity(resolvedReplay.id)!, replayed: true };
      }
      if (resolvedReplay.resolution_digest !== resolutionDigest) {
        throw new TeamMemoryError('memory_idempotency_conflict', idempotencyKey);
      }
      return {
        opportunity: resolvedReplay,
        memory: resolvedReplay.resolved_memory_id
          ? getMemory(resolvedReplay.resolved_memory_id)
          : undefined,
        replayed: true,
      };
    }
    const pending = opportunity?.disposition === 'deferred' ? opportunity : undefined;
    if (input.opportunityId && (
      !pending
      || pending.conversation_id !== input.conversationId
      || pending.agent_id !== input.agentId
    )) throw new TeamMemoryError('memory_opportunity_unavailable', input.opportunityId);
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
          const updated = db.prepare(`
            UPDATE team_memory_opportunity
            SET disposition='abstained',reason_code=?,updated_at=?,resolved_at=?,
                resolution_idempotency_key=?,resolution_digest=?
            WHERE id=? AND disposition='deferred'
          `).run(
            input.reasonCode ?? 'agent_abstained',
            now,
            now,
            idempotencyKey,
            resolutionDigest,
            pending.id,
          );
          if (updated.changes !== 1) {
            throw new TeamMemoryError('memory_opportunity_unavailable', pending.id);
          }
        } else {
          db.prepare(`
            INSERT INTO team_memory_opportunity (
              id,idempotency_key,conversation_id,task_id,agent_id,kind_hint,
              source_refs_json,disposition,reason_code,created_at,updated_at,resolved_at,
              resolution_idempotency_key,resolution_digest
            ) VALUES (?,?,?,?,?,?,?,'abstained',?,?,?,?,?,?)
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
            idempotencyKey,
            resolutionDigest,
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
    if (!['project', 'task', 'agent'].includes(scope)) {
      throw new TeamMemoryError('memory_scope_invalid', `Unsupported scope: ${scope}`);
    }
    if (!['team', 'agent'].includes(visibility)) {
      throw new TeamMemoryError('memory_visibility_invalid', `Unsupported visibility: ${visibility}`);
    }
    if (scope === 'task' && !input.taskId) throw new TeamMemoryError('memory_task_required', 'task scope requires taskId');
    if (scope === 'task' && !sources.some((source) => source.taskIds.includes(input.taskId!))) {
      throw new TeamMemoryError('memory_task_source_mismatch', 'task-scoped memory requires a source from the current task');
    }
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
      assertRelationshipEndpointsAreAgents(input.conversationId, input.relationship, sources);
    } else if (input.relationship) {
      throw new TeamMemoryError('memory_relationship_invalid', 'relationship coordinates require relationship kind');
    }
    if (input.supersedesId) {
      const superseded = getMemory(input.supersedesId);
      if (
        !superseded
        || superseded.conversation_id !== input.conversationId
        || superseded.status !== 'accepted'
        || (superseded.visibility === 'agent' && superseded.owner_agent_id !== input.agentId)
      ) {
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
        'proposed',
        input.relationship?.subjectAgentId ?? null,
        input.relationship?.objectAgentId ?? null,
        input.relationship?.relationKind ?? null,
        JSON.stringify(sourceRefs),
        input.agentId,
        null,
        input.supersedesId ?? null,
        now,
        now,
      );
      if (input.supersedesId) {
        assertSupersessionCompatible(getMemory(memoryId)!, getMemory(input.supersedesId)!);
      }
      if (pending) {
        const resolved = db.prepare(`
          UPDATE team_memory_opportunity
          SET disposition='proposed',resolved_memory_id=?,reason_code=?,updated_at=?,resolved_at=?,
              resolution_idempotency_key=?,resolution_digest=?
          WHERE id=? AND disposition='deferred'
        `).run(
          memoryId,
          admission.reason,
          now,
          now,
          idempotencyKey,
          resolutionDigest,
          pending.id,
        );
        if (resolved.changes !== 1) {
          throw new TeamMemoryError('memory_opportunity_unavailable', pending.id);
        }
      } else {
        db.prepare(`
          INSERT INTO team_memory_opportunity (
            id,idempotency_key,conversation_id,task_id,agent_id,kind_hint,
            source_refs_json,disposition,reason_code,resolved_memory_id,
            created_at,updated_at,resolved_at,resolution_idempotency_key,resolution_digest
          ) VALUES (?,?,?,?,?,?,?,'proposed',?,?,?,?,?,?,?)
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
          idempotencyKey,
          resolutionDigest,
        );
      }
      event({
        conversationId: input.conversationId,
        memoryId,
        opportunityId,
        eventType: 'memory.proposed',
        actor: { type: 'agent', id: input.agentId },
        reasonCode: admission.reason,
        metadata: { sourceDigest: stableDigest(sourceRefs) },
        now,
      });
      if (admission.accepted) {
        acceptMemory({
          memoryId,
          expectedRevision: 0,
          actor: { type: 'system', id: 'evidence-gate-v1' },
          reasonCode: admission.reason,
          now,
        });
      }
    }).immediate();
    return { opportunity: getOpportunity(opportunityId)!, memory: getMemory(memoryId)!, replayed: false };
  }

  decide(input: DecideMemoryInput): TeamMemoryItemRow {
    const memory = getMemory(input.memoryId);
    if (!memory) throw new TeamMemoryError('memory_not_found', input.memoryId);
    if (memory.revision !== input.expectedRevision) {
      throw new TeamMemoryError('memory_revision_stale', input.memoryId);
    }
    if (input.decision === 'accept' && memory.status !== 'proposed') {
      throw new TeamMemoryError('memory_transition_invalid', `${memory.status} -> accepted`);
    }
    if (input.decision === 'retire' && !['proposed', 'accepted'].includes(memory.status)) {
      throw new TeamMemoryError('memory_transition_invalid', `${memory.status} -> retired`);
    }
    const now = new Date().toISOString();
    const result = getDb().transaction(() => {
      const reasonCode = requiredText(input.reasonCode, 'reasonCode', 200);
      if (input.decision === 'accept') {
        return acceptMemory({
          memoryId: memory.id,
          expectedRevision: input.expectedRevision,
          actor: input.actor,
          reasonCode,
          now,
        });
      }
      const updated = getDb().prepare(`
        UPDATE team_memory_item
        SET status='retired',revision=revision+1,updated_at=?,retired_at=?
        WHERE id=? AND revision=? AND status IN ('proposed','accepted')
      `).run(now, now, input.memoryId, input.expectedRevision);
      if (updated.changes !== 1) throw new TeamMemoryError('memory_revision_stale', input.memoryId);
      event({
        conversationId: memory.conversation_id,
        memoryId: memory.id,
        eventType: 'memory.retired',
        actor: input.actor,
        reasonCode,
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
      } catch (error) {
        console.warn('[team-memory] FTS recall failed; using canonical recent rows', error);
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

  rebuildIndex(): { canonicalCount: number; indexedCount: number } {
    const db = getDb();
    return db.transaction(() => {
      db.prepare('DELETE FROM team_memory_fts').run();
      db.prepare(`
        INSERT INTO team_memory_fts(memory_id,content)
        SELECT id,content FROM team_memory_item WHERE status='accepted'
      `).run();
      const canonicalCount = Number((db.prepare(`
        SELECT COUNT(*) AS count FROM team_memory_item WHERE status='accepted'
      `).get() as { count: number }).count);
      const indexedCount = Number((db.prepare(`
        SELECT COUNT(*) AS count FROM team_memory_fts
      `).get() as { count: number }).count);
      if (canonicalCount !== indexedCount) {
        throw new TeamMemoryError('memory_index_inconsistent', `${canonicalCount}:${indexedCount}`);
      }
      return { canonicalCount, indexedCount };
    }).immediate();
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
    const passAggregates = db.prepare(`
      SELECT
        CASE WHEN pass.from_holder_id=? THEN pass.to_agent_id ELSE pass.from_holder_id END AS other_agent_id,
        COUNT(*) AS handoff_count,
        SUM(CASE WHEN pass.status='completed' THEN 1 ELSE 0 END) AS completed_count,
        MAX(pass.updated_at) AS last_observed_at
      FROM a2a_pass pass
      JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
      JOIN a2a_possession source_possession ON source_possession.id=pass.from_possession_id
      WHERE chain.conversation_id=?
        AND source_possession.holder_type='agent'
        AND (pass.from_holder_id=? OR pass.to_agent_id=?)
        AND pass.from_holder_id<>pass.to_agent_id
      GROUP BY other_agent_id
    `).all(agentId, conversationId, agentId, agentId) as Array<{
      other_agent_id: string;
      handoff_count: number;
      completed_count: number;
      last_observed_at: string;
    }>;
    for (const aggregate of passAggregates) {
      if (!aggregate.other_agent_id || aggregate.other_agent_id === agentId) continue;
      const summary = ensure(aggregate.other_agent_id, aggregate.last_observed_at);
      summary.handoffCount = Number(aggregate.handoff_count);
      summary.completedHandoffCount = Number(aggregate.completed_count);
    }
    const reviewAggregates = db.prepare(`
      SELECT
        CASE WHEN action.actor_id=? THEN task.agent_id ELSE action.actor_id END AS other_agent_id,
        COUNT(*) AS review_count,
        MAX(action.created_at) AS last_observed_at
      FROM task_action action
      JOIN json_each(action.task_ids) task_ref
      JOIN task ON task.id=task_ref.value AND task.conversation_id=action.conversation_id
      WHERE action.conversation_id=? AND action.type='task.provider_review_received'
        AND action.actor_type='agent'
        AND (action.actor_id=? OR task.agent_id=?)
        AND action.actor_id<>task.agent_id
      GROUP BY other_agent_id
    `).all(agentId, conversationId, agentId, agentId) as Array<{
      other_agent_id: string;
      review_count: number;
      last_observed_at: string;
    }>;
    for (const aggregate of reviewAggregates) {
      if (!aggregate.other_agent_id || aggregate.other_agent_id === agentId) continue;
      const summary = ensure(aggregate.other_agent_id, aggregate.last_observed_at);
      summary.reviewCount = Number(aggregate.review_count);
    }
    const selectedSummaries = [...summaries.values()]
      .sort((left, right) => (
        right.lastObservedAt.localeCompare(left.lastObservedAt)
        || left.otherAgentId.localeCompare(right.otherAgentId)
      ))
      .slice(0, 5);
    const selectedAgentIds = JSON.stringify(selectedSummaries.map((summary) => summary.otherAgentId));
    const recentPasses = db.prepare(`
      WITH facts AS (
        SELECT pass.id,
          CASE WHEN pass.from_holder_id=? THEN pass.to_agent_id ELSE pass.from_holder_id END AS other_agent_id,
          pass.updated_at
        FROM a2a_pass pass
        JOIN a2a_possession_chain chain ON chain.id=pass.chain_id
        JOIN a2a_possession source_possession ON source_possession.id=pass.from_possession_id
        WHERE chain.conversation_id=? AND source_possession.holder_type='agent'
          AND (pass.from_holder_id=? OR pass.to_agent_id=?)
      ), ranked AS (
        SELECT *,ROW_NUMBER() OVER (
          PARTITION BY other_agent_id ORDER BY updated_at DESC,id DESC
        ) AS evidence_rank
        FROM facts
      )
      SELECT id,other_agent_id FROM ranked
      WHERE evidence_rank<=3 AND other_agent_id IN (SELECT value FROM json_each(?))
      ORDER BY other_agent_id,evidence_rank
    `).all(agentId, conversationId, agentId, agentId, selectedAgentIds) as Array<{
      id: string; other_agent_id: string;
    }>;
    for (const pass of recentPasses) {
      const summary = summaries.get(pass.other_agent_id);
      if (summary && summary.evidenceRefs.length < 3) summary.evidenceRefs.push(`a2a-pass:${pass.id}`);
    }
    const recentReviews = db.prepare(`
      WITH facts AS (
        SELECT action.id,
          CASE WHEN action.actor_id=? THEN task.agent_id ELSE action.actor_id END AS other_agent_id,
          action.created_at
        FROM task_action action
        JOIN json_each(action.task_ids) task_ref
        JOIN task ON task.id=task_ref.value AND task.conversation_id=action.conversation_id
        WHERE action.conversation_id=? AND action.type='task.provider_review_received'
          AND action.actor_type='agent' AND (action.actor_id=? OR task.agent_id=?)
      ), ranked AS (
        SELECT *,ROW_NUMBER() OVER (
          PARTITION BY other_agent_id ORDER BY created_at DESC,id DESC
        ) AS evidence_rank
        FROM facts
      )
      SELECT id,other_agent_id FROM ranked
      WHERE evidence_rank<=3 AND other_agent_id IN (SELECT value FROM json_each(?))
      ORDER BY other_agent_id,evidence_rank
    `).all(agentId, conversationId, agentId, agentId, selectedAgentIds) as Array<{
      id: string; other_agent_id: string;
    }>;
    for (const review of recentReviews) {
      const summary = summaries.get(review.other_agent_id);
      if (summary && summary.evidenceRefs.length < 3) summary.evidenceRefs.push(`task-action:${review.id}`);
    }
    return selectedSummaries;
  }
}

export const teamMemory = new TeamMemory();
