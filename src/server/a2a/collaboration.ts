import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { AgentInbox, type AgentInboxItem } from '../platform-events/agent-inbox';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { generateSortableId } from '../repositories/sortable-id';
import type {
  A2AHandoffPacket,
  A2APossession,
  A2APossessionChain,
  PassIntent,
  PassStatus,
} from './types-possession';

export type A2APassGroupStatus =
  | 'offered'
  | 'active'
  | 'recovering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface A2APassGroup {
  id: string;
  chainId: string;
  sourcePossessionId: string;
  sourceWorkId?: string;
  deliveryRunId?: string;
  idempotencyKey: string;
  requestDigest: string;
  mode: 'transfer' | 'fan_out';
  status: A2APassGroupStatus;
  expectedCount: number;
  resolvedCount: number;
  recoveryPossessionId?: string;
  hopCount: number;
  maxHops: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface A2AAggregatePass {
  id: string;
  chainId: string;
  groupId: string;
  fromPossessionId: string;
  fromHolderId: string;
  toAgentId: string;
  status: PassStatus;
  intent: PassIntent;
  hopCount: number;
  handoffPacketId: string;
  targetPossessionId?: string;
  inboxItemId?: string;
  taskId?: string;
  reason?: string;
  phase?: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface OfferedPassGroup {
  group: A2APassGroup;
  passes: A2AAggregatePass[];
  packets: A2AHandoffPacket[];
  inboxItems: AgentInboxItem[];
  duplicate: boolean;
}

export interface AbortedA2ACollaboration {
  chainId: string;
  cancelledInboxItems: number;
}

interface ChainRow {
  id: string;
  conversation_id: string;
  root_trigger_type: A2APossessionChain['rootTriggerType'];
  root_trigger_id: string;
  status: A2APossessionChain['status'];
  current_holder_id: string;
  config: string;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PossessionRow {
  id: string;
  chain_id: string;
  holder_id: string;
  holder_type: A2APossession['holderType'];
  status: A2APossession['status'];
  parent_pass_id: string | null;
  revision: number;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  summary: string | null;
}

interface PassRow {
  id: string;
  chain_id: string;
  group_id: string | null;
  from_possession_id: string;
  from_holder_id: string;
  to_agent_id: string;
  status: PassStatus;
  intent: PassIntent;
  phase: string | null;
  reason: string | null;
  handoff_packet_id: string | null;
  idempotency_key: string | null;
  hop_count: number;
  target_possession_id: string | null;
  inbox_item_id: string | null;
  task_id: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface GroupRow {
  id: string;
  chain_id: string;
  source_possession_id: string;
  source_work_id: string | null;
  delivery_run_id: string | null;
  idempotency_key: string;
  request_digest: string;
  mode: A2APassGroup['mode'];
  status: A2APassGroupStatus;
  expected_count: number;
  resolved_count: number;
  recovery_possession_id: string | null;
  hop_count: number;
  max_hops: number;
  revision: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface PacketRow {
  id: string;
  chain_id: string;
  pass_id: string;
  from_holder_id: string;
  to_agent_id: string;
  title: string;
  requested_action: string;
  possession_summary: string;
  relevant_decisions: string;
  evidence_refs: string;
  constraints: string;
  open_questions: string;
  forbidden_behaviors: string;
  source_message_ids: string;
  created_at: string;
}

const RESOLVED_PASS_STATUSES = new Set<PassStatus>([
  'completed',
  'blocked',
  'rejected',
  'timeout',
  'error',
]);
const FAILED_PASS_STATUSES = new Set<PassStatus>([
  'blocked',
  'rejected',
  'timeout',
  'error',
]);

export class A2ACollaborationInvariantError extends Error {
  constructor(readonly reasonCode: string, detail: string) {
    super(`${reasonCode}: ${detail}`);
  }
}

export class StaleA2ARevisionError extends Error {
  readonly reasonCode = 'stale_a2a_revision';

  constructor(
    readonly aggregateId: string,
    readonly expectedRevision: number,
    readonly actualRevision: number,
  ) {
    super(
      `Stale A2A revision for ${aggregateId}: expected ${expectedRevision}, actual ${actualRevision}`,
    );
  }
}

export class A2AIdempotencyConflictError extends Error {
  readonly reasonCode = 'a2a_idempotency_conflict';

  constructor(readonly idempotencyKey: string) {
    super(`A2A idempotency key is already bound to different content: ${idempotencyKey}`);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function nonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new A2ACollaborationInvariantError('a2a_field_required', field);
  return normalized;
}

function chainFromRow(row: ChainRow): A2APossessionChain & { revision: number; updatedAt: string } {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    correlationId: chainCorrelationId(row),
    rootTriggerType: row.root_trigger_type,
    rootTriggerId: row.root_trigger_id,
    status: row.status,
    currentHolderId: row.current_holder_id,
    config: JSON.parse(row.config) as Record<string, unknown>,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function chainCorrelationId(row: ChainRow): string {
  try {
    const value = (JSON.parse(row.config) as Record<string, unknown>).correlationId;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // Legacy rows fall back to their stable collaboration identity.
  }
  return row.id;
}

function possessionFromRow(
  row: PossessionRow,
): A2APossession & { parentPassId?: string; revision: number; updatedAt: string } {
  return {
    id: row.id,
    chainId: row.chain_id,
    holderId: row.holder_id,
    holderType: row.holder_type,
    status: row.status,
    parentPassId: row.parent_pass_id ?? undefined,
    revision: row.revision,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    summary: row.summary ?? undefined,
  };
}

function passFromRow(row: PassRow): A2AAggregatePass {
  if (!row.group_id || !row.handoff_packet_id || !row.idempotency_key) {
    throw new A2ACollaborationInvariantError(
      'a2a_legacy_pass_not_authoritative',
      `Pass ${row.id} has no aggregate binding`,
    );
  }
  return {
    id: row.id,
    chainId: row.chain_id,
    groupId: row.group_id,
    fromPossessionId: row.from_possession_id,
    fromHolderId: row.from_holder_id,
    toAgentId: row.to_agent_id,
    status: row.status,
    intent: row.intent,
    hopCount: row.hop_count,
    handoffPacketId: row.handoff_packet_id,
    targetPossessionId: row.target_possession_id ?? undefined,
    inboxItemId: row.inbox_item_id ?? undefined,
    taskId: row.task_id ?? undefined,
    reason: row.reason ?? undefined,
    phase: row.phase ?? undefined,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function groupFromRow(row: GroupRow): A2APassGroup {
  return {
    id: row.id,
    chainId: row.chain_id,
    sourcePossessionId: row.source_possession_id,
    sourceWorkId: row.source_work_id ?? undefined,
    deliveryRunId: row.delivery_run_id ?? undefined,
    idempotencyKey: row.idempotency_key,
    requestDigest: row.request_digest,
    mode: row.mode,
    status: row.status,
    expectedCount: row.expected_count,
    resolvedCount: row.resolved_count,
    recoveryPossessionId: row.recovery_possession_id ?? undefined,
    hopCount: row.hop_count,
    maxHops: row.max_hops,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function packetFromRow(row: PacketRow): A2AHandoffPacket {
  return {
    id: row.id,
    chainId: row.chain_id,
    passId: row.pass_id,
    fromHolderId: row.from_holder_id,
    toAgentId: row.to_agent_id,
    title: row.title,
    requestedAction: row.requested_action,
    possessionSummary: row.possession_summary,
    relevantDecisions: JSON.parse(row.relevant_decisions) as string[],
    evidenceRefs: JSON.parse(row.evidence_refs) as A2AHandoffPacket['evidenceRefs'],
    constraints: JSON.parse(row.constraints) as string[],
    openQuestions: JSON.parse(row.open_questions) as string[],
    forbiddenBehaviors: JSON.parse(row.forbidden_behaviors) as string[],
    sourceMessageIds: JSON.parse(row.source_message_ids) as string[],
    createdAt: row.created_at,
  };
}

function renderPacket(packet: Omit<
  A2AHandoffPacket,
  'id' | 'chainId' | 'passId' | 'fromHolderId' | 'toAgentId' | 'createdAt'
>): string {
  return [
    packet.title,
    '',
    `Requested action: ${packet.requestedAction}`,
    `Possession summary: ${packet.possessionSummary}`,
    ...(packet.constraints.length ? ['', 'Constraints:', ...packet.constraints.map((item) => `- ${item}`)] : []),
    ...(packet.openQuestions.length ? ['', 'Open questions:', ...packet.openQuestions.map((item) => `- ${item}`)] : []),
  ].join('\n');
}

export interface A2ACollaborationRepositoryOptions {
  db?: Database.Database;
  inbox?: AgentInbox;
  now?: () => Date;
  idFactory?: (prefix: 'a2a-chain' | 'a2a-possession' | 'a2a-group' | 'a2a-pass' | 'a2a-packet') => string;
}

export class A2ACollaborationRepository {
  private readonly database?: Database.Database;
  private readonly inbox: AgentInbox;
  private readonly now: () => Date;
  private readonly idFactory: NonNullable<A2ACollaborationRepositoryOptions['idFactory']>;

  constructor(options: A2ACollaborationRepositoryOptions = {}) {
    this.database = options.db;
    this.inbox = options.inbox ?? new AgentInbox({ db: options.db });
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? ((prefix) => generateSortableId(prefix));
  }

  private db(): Database.Database {
    return this.database ?? getDb();
  }

  createChain(input: {
    conversationId: string;
    rootTriggerType: A2APossessionChain['rootTriggerType'];
    rootTriggerId: string;
    correlationId?: string;
    holderId: string;
    holderType: A2APossession['holderType'];
    config?: Record<string, unknown>;
  }): {
    chain: A2APossessionChain & { revision: number; updatedAt: string };
    rootPossession: A2APossession & { revision: number; updatedAt: string };
    duplicate: boolean;
  } {
    const conversationId = nonEmpty(input.conversationId, 'conversationId');
    const rootTriggerId = nonEmpty(input.rootTriggerId, 'rootTriggerId');
    const correlationId = input.correlationId?.trim() || rootTriggerId;
    const holderId = nonEmpty(input.holderId, 'holderId');
    const db = this.db();
    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT * FROM a2a_possession_chain
        WHERE conversation_id=? AND root_trigger_type=? AND root_trigger_id=?
        ORDER BY created_at DESC LIMIT 1
      `).get(conversationId, input.rootTriggerType, rootTriggerId) as ChainRow | undefined;
      if (existing) {
        if (input.correlationId && chainCorrelationId(existing) !== correlationId) {
          throw new A2ACollaborationInvariantError(
            'a2a_root_correlation_conflict',
            `${chainCorrelationId(existing)}:${correlationId}`,
          );
        }
        const root = db.prepare(`
          SELECT * FROM a2a_possession
          WHERE chain_id=? AND parent_pass_id IS NULL
          ORDER BY started_at ASC,id ASC LIMIT 1
        `).get(existing.id) as PossessionRow;
        return {
          chain: chainFromRow(existing),
          rootPossession: possessionFromRow(root),
          duplicate: true,
        };
      }
      const active = db.prepare(`
        SELECT id FROM a2a_possession_chain
        WHERE conversation_id=? AND status='active' LIMIT 1
      `).get(conversationId) as { id: string } | undefined;
      if (active) {
        throw new A2ACollaborationInvariantError(
          'a2a_active_chain_exists',
          `Conversation ${conversationId} already has active chain ${active.id}`,
        );
      }
      const now = this.now().toISOString();
      const chainId = this.idFactory('a2a-chain');
      const possessionId = this.idFactory('a2a-possession');
      db.prepare(`
        INSERT INTO a2a_possession_chain (
          id,conversation_id,root_trigger_type,root_trigger_id,status,
          current_holder_id,config,revision,created_at,updated_at,completed_at
        ) VALUES (?,?,?,?,'active',?,?,0,?,?,NULL)
      `).run(
        chainId,
        conversationId,
        input.rootTriggerType,
        rootTriggerId,
        holderId,
        JSON.stringify({ ...input.config, correlationId }),
        now,
        now,
      );
      db.prepare(`
        INSERT INTO a2a_possession (
          id,chain_id,holder_id,holder_type,status,parent_pass_id,revision,
          started_at,updated_at,completed_at,summary
        ) VALUES (?,?,?,?,'open',NULL,0,?,?,NULL,NULL)
      `).run(possessionId, chainId, holderId, input.holderType, now, now);
      new DomainEventPublisher(db).publish({
        type: 'a2a.chain.started',
        projectId: conversationId,
        aggregate: { type: 'a2a_collaboration', id: chainId, version: 0 },
        actor: { type: input.holderType === 'agent' ? 'agent' : input.holderType, id: holderId },
        correlationId,
        causationId: rootTriggerId,
        occurredAt: now,
        payload: { chainId, rootPossessionId: possessionId, holderId },
      });
      return {
        chain: chainFromRow(this.getChainRow(chainId)!),
        rootPossession: possessionFromRow(this.getPossessionRow(possessionId)!),
        duplicate: false,
      };
    }).immediate();
  }

  findChainByRoot(
    conversationId: string,
    rootTriggerType: A2APossessionChain['rootTriggerType'],
    rootTriggerId: string,
  ) {
    const row = this.db().prepare(`
      SELECT * FROM a2a_possession_chain
      WHERE conversation_id=? AND root_trigger_type=? AND root_trigger_id=?
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get(conversationId, rootTriggerType, rootTriggerId) as ChainRow | undefined;
    return row ? chainFromRow(row) : undefined;
  }

  abortActiveChain(
    conversationId: string,
    reasonCode: string,
  ): AbortedA2ACollaboration | undefined {
    const db = this.db();
    return db.transaction(() => {
      const chain = db.prepare(`
        SELECT * FROM a2a_possession_chain
        WHERE conversation_id=? AND status='active'
        ORDER BY created_at DESC,id DESC LIMIT 1
      `).get(conversationId) as ChainRow | undefined;
      if (!chain) return undefined;
      const now = this.now().toISOString();
      let cancelledInboxItems = 0;
      const passes = db.prepare(`
        SELECT * FROM a2a_pass
        WHERE chain_id=? AND group_id IS NOT NULL
          AND status IN ('offered','accepted','starting')
      `).all(chain.id) as PassRow[];
      for (const pass of passes) {
        if (!pass.inbox_item_id) continue;
        const item = this.inbox.get(pass.inbox_item_id);
        if (!item) continue;
        cancelledInboxItems += this.inbox.cancelPending(
          item.projectId,
          item.projectAgentId,
          item.idempotencyKey,
        );
      }
      db.prepare(`
        UPDATE a2a_pass
        SET status=CASE WHEN status='started' THEN 'error' ELSE 'rejected' END,
            phase='holder',reason=?,revision=revision+1,updated_at=?
        WHERE chain_id=? AND group_id IS NOT NULL
          AND status IN ('drafted','validated','offered','accepted','starting','started')
      `).run(nonEmpty(reasonCode, 'reasonCode'), now, chain.id);
      db.prepare(`
        UPDATE a2a_possession
        SET status='aborted',completed_at=?,updated_at=?,revision=revision+1
        WHERE chain_id=? AND status NOT IN ('completed','aborted','timeout')
      `).run(now, now, chain.id);
      db.prepare(`
        UPDATE a2a_pass_group
        SET status='cancelled',completed_at=?,updated_at=?,revision=revision+1
        WHERE chain_id=? AND status IN ('offered','active','recovering')
      `).run(now, now, chain.id);
      const result = db.prepare(`
        UPDATE a2a_possession_chain
        SET status='aborted',completed_at=?,updated_at=?,revision=revision+1
        WHERE id=? AND status='active' AND revision=?
      `).run(now, now, chain.id, chain.revision);
      if (result.changes !== 1) {
        const current = this.getChainRow(chain.id)!;
        throw new StaleA2ARevisionError(chain.id, chain.revision, current.revision);
      }
      new DomainEventPublisher(db).publish({
        type: 'a2a.chain.aborted',
        projectId: conversationId,
        aggregate: {
          type: 'a2a_collaboration',
          id: chain.id,
          version: chain.revision + 1,
        },
        actor: { type: 'user', id: 'human' },
        correlationId: chainCorrelationId(chain),
        causationId: reasonCode,
        occurredAt: now,
        payload: { status: 'aborted', reason: reasonCode },
      });
      return { chainId: chain.id, cancelledInboxItems };
    }).immediate();
  }

  offerPassGroup(input: {
    chainId: string;
    sourcePossessionId: string;
    sourceWorkId?: string;
    deliveryRunId?: string;
    expectedSourceRevision: number;
    idempotencyKey: string;
    maxHops?: number;
    branches: Array<{
      toAgentId: string;
      intent: PassIntent;
      taskId?: string;
      packet: Omit<
        A2AHandoffPacket,
        'id' | 'chainId' | 'passId' | 'fromHolderId' | 'toAgentId' | 'createdAt'
      >;
    }>;
  }): OfferedPassGroup {
    if (input.branches.length === 0) {
      throw new A2ACollaborationInvariantError('a2a_pass_group_empty', input.chainId);
    }
    const targets = input.branches.map((branch) => nonEmpty(branch.toAgentId, 'toAgentId'));
    if (new Set(targets).size !== targets.length) {
      throw new A2ACollaborationInvariantError('a2a_duplicate_group_target', input.chainId);
    }
    const idempotencyKey = nonEmpty(input.idempotencyKey, 'idempotencyKey');
    const requestDigest = digest({
      chainId: input.chainId,
      sourcePossessionId: input.sourcePossessionId,
      sourceWorkId: input.sourceWorkId,
      deliveryRunId: input.deliveryRunId,
      branches: input.branches,
    });
    const db = this.db();
    return db.transaction(() => {
      const duplicate = db.prepare(`
        SELECT * FROM a2a_pass_group WHERE chain_id=? AND idempotency_key=?
      `).get(input.chainId, idempotencyKey) as GroupRow | undefined;
      if (duplicate) {
        if (duplicate.request_digest !== requestDigest) {
          throw new A2AIdempotencyConflictError(idempotencyKey);
        }
        return this.loadOfferedGroup(duplicate, true);
      }
      const chain = this.getChainRow(input.chainId);
      if (!chain || chain.status !== 'active') {
        throw new A2ACollaborationInvariantError('a2a_chain_not_active', input.chainId);
      }
      const source = this.getPossessionRow(input.sourcePossessionId);
      if (!source || source.chain_id !== chain.id || source.status !== 'open') {
        throw new A2ACollaborationInvariantError(
          'a2a_source_not_open',
          input.sourcePossessionId,
        );
      }
      if (source.revision !== input.expectedSourceRevision) {
        throw new StaleA2ARevisionError(
          source.id,
          input.expectedSourceRevision,
          source.revision,
        );
      }
      const ancestry = this.ancestry(source);
      const maxHops = input.maxHops
        ?? Number((JSON.parse(chain.config) as Record<string, unknown>).maxDepth ?? 5);
      const hopCount = this.parentHopCount(source) + 1;
      for (const target of targets) {
        if (ancestry.holderIds.has(target)) {
          throw new A2ACollaborationInvariantError(
            'a2a_cycle_detected',
            `${[...ancestry.holderIds, target].join(' -> ')}`,
          );
        }
      }
      if (!Number.isSafeInteger(maxHops) || maxHops <= 0 || hopCount > maxHops) {
        throw new A2ACollaborationInvariantError(
          'a2a_hop_budget_exceeded',
          `${hopCount}/${maxHops}`,
        );
      }

      const now = this.now().toISOString();
      const groupId = this.idFactory('a2a-group');
      const mode = input.branches.length === 1 ? 'transfer' : 'fan_out';
      db.prepare(`
        INSERT INTO a2a_pass_group (
          id,chain_id,source_possession_id,source_work_id,delivery_run_id,
          idempotency_key,request_digest,mode,status,
          expected_count,resolved_count,recovery_possession_id,hop_count,max_hops,
          revision,created_at,updated_at,completed_at
        ) VALUES (?,?,?,?,?,?,?,?,'offered',?,0,NULL,?,?,0,?,?,NULL)
      `).run(
        groupId,
        chain.id,
        source.id,
        input.sourceWorkId?.trim() || null,
        input.deliveryRunId?.trim() || null,
        idempotencyKey,
        requestDigest,
        mode,
        input.branches.length,
        hopCount,
        maxHops,
        now,
        now,
      );

      const passIds: string[] = [];
      const packetIds: string[] = [];
      for (const [index, branch] of input.branches.entries()) {
        const passId = this.idFactory('a2a-pass');
        const packetId = this.idFactory('a2a-packet');
        const branchKey = `${idempotencyKey}:${index}:${branch.toAgentId}`;
        passIds.push(passId);
        packetIds.push(packetId);
        db.prepare(`
          INSERT INTO a2a_pass (
            id,chain_id,from_possession_id,from_holder_id,to_agent_id,status,intent,
            phase,reason,handoff_packet_id,group_id,idempotency_key,hop_count,
            target_possession_id,inbox_item_id,task_id,revision,created_at,updated_at
          ) VALUES (?,?,?,?,?,'offered',?,NULL,NULL,?,?,?,?,NULL,NULL,?,0,?,?)
        `).run(
          passId,
          chain.id,
          source.id,
          source.holder_id,
          branch.toAgentId,
          branch.intent,
          packetId,
          groupId,
          branchKey,
          hopCount,
          branch.taskId ?? null,
          now,
          now,
        );
        db.prepare(`
          INSERT INTO a2a_handoff_packet (
            id,chain_id,pass_id,from_holder_id,to_agent_id,title,requested_action,
            possession_summary,relevant_decisions,evidence_refs,constraints,
            open_questions,forbidden_behaviors,source_message_ids,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          packetId,
          chain.id,
          passId,
          source.holder_id,
          branch.toAgentId,
          nonEmpty(branch.packet.title, 'packet.title'),
          nonEmpty(branch.packet.requestedAction, 'packet.requestedAction'),
          nonEmpty(branch.packet.possessionSummary, 'packet.possessionSummary'),
          JSON.stringify(branch.packet.relevantDecisions),
          JSON.stringify(branch.packet.evidenceRefs),
          JSON.stringify(branch.packet.constraints),
          JSON.stringify(branch.packet.openQuestions),
          JSON.stringify(branch.packet.forbiddenBehaviors),
          JSON.stringify(branch.packet.sourceMessageIds),
          now,
        );
      }
      const offeredEvent = new DomainEventPublisher(db).publish({
        type: 'a2a.pass.group_offered',
        projectId: chain.conversation_id,
        aggregate: { type: 'a2a_pass_group', id: groupId, version: 0 },
        actor: {
          type: source.holder_type === 'agent' ? 'agent' : source.holder_type,
          id: source.holder_id,
        },
        correlationId: chainCorrelationId(chain),
        causationId: idempotencyKey,
        occurredAt: now,
        payload: {
          chainId: chain.id,
          groupId,
          sourcePossessionId: source.id,
          passIds,
          mode,
        },
      });
      for (const [index, branch] of input.branches.entries()) {
        const inboxItem = this.inbox.enqueue({
          projectId: chain.conversation_id,
          projectAgentId: branch.toAgentId,
          idempotencyKey: `a2a:${chain.id}:${passIds[index]}`,
          sourceEvent: offeredEvent,
          command: {
            source: 'a2a',
            prompt: renderPacket(branch.packet),
            workId: `a2a-pass:${passIds[index]}`,
            taskId: branch.taskId,
            deliveryRunId: input.deliveryRunId,
            fromAgentId: source.holder_id,
            chainId: chain.id,
            passId: passIds[index],
            contextScenario: 'handoff',
          },
        });
        db.prepare(`
          UPDATE a2a_pass SET inbox_item_id=?,updated_at=? WHERE id=?
        `).run(inboxItem.id, now, passIds[index]);
      }
      const updated = db.prepare(`
        UPDATE a2a_possession
        SET status='handoff_offered',revision=revision+1,updated_at=?
        WHERE id=? AND status='open' AND revision=?
      `).run(now, source.id, input.expectedSourceRevision);
      if (updated.changes !== 1) {
        const current = this.getPossessionRow(source.id)!;
        throw new StaleA2ARevisionError(
          source.id,
          input.expectedSourceRevision,
          current.revision,
        );
      }
      return this.loadOfferedGroup(this.getGroupRow(groupId)!, false);
    }).immediate();
  }

  markPassAdmitted(passId: string, expectedRevision: number): A2AAggregatePass {
    return this.transitionPass(passId, 'offered', 'accepted', expectedRevision);
  }

  markPassStarting(passId: string, expectedRevision: number): A2AAggregatePass {
    return this.transitionPass(passId, 'accepted', 'starting', expectedRevision);
  }

  markPassStarted(
    passId: string,
    expectedRevision: number,
  ): {
    pass: A2AAggregatePass;
    possession: A2APossession & { parentPassId?: string; revision: number; updatedAt: string };
  } {
    const db = this.db();
    return db.transaction(() => {
      const pass = this.requireAggregatePass(passId);
      if (pass.revision !== expectedRevision) {
        throw new StaleA2ARevisionError(pass.id, expectedRevision, pass.revision);
      }
      if (pass.status !== 'starting') {
        throw new A2ACollaborationInvariantError(
          'a2a_invalid_pass_transition',
          `${pass.status} -> started`,
        );
      }
      const chain = this.getChainRow(pass.chainId);
      if (!chain || chain.status !== 'active') {
        throw new A2ACollaborationInvariantError('a2a_chain_not_active', pass.chainId);
      }
      const now = this.now().toISOString();
      const possessionId = this.idFactory('a2a-possession');
      db.prepare(`
        INSERT INTO a2a_possession (
          id,chain_id,holder_id,holder_type,status,parent_pass_id,revision,
          started_at,updated_at,completed_at,summary
        ) VALUES (?,?,?,'agent','open',?,0,?,?,NULL,NULL)
      `).run(possessionId, pass.chainId, pass.toAgentId, pass.id, now, now);
      const updated = db.prepare(`
        UPDATE a2a_pass
        SET status='started',target_possession_id=?,revision=revision+1,updated_at=?
        WHERE id=? AND status='starting' AND revision=?
      `).run(possessionId, now, pass.id, expectedRevision);
      if (updated.changes !== 1) {
        throw new StaleA2ARevisionError(pass.id, expectedRevision, this.requirePassRow(pass.id)!.revision);
      }
      db.prepare(`
        UPDATE a2a_possession_chain
        SET current_holder_id=?,revision=revision+1,updated_at=?
        WHERE id=? AND status='active'
      `).run(pass.toAgentId, now, pass.chainId);
      this.resolveGroupIfSettled(pass.groupId, now);
      const current = this.requireAggregatePass(pass.id);
      new DomainEventPublisher(db).publish({
        type: 'a2a.pass.started',
        projectId: chain.conversation_id,
        aggregate: { type: 'a2a_pass', id: pass.id, version: current.revision },
        actor: { type: 'system', id: 'a2a-collaboration' },
        subject: { type: 'agent', id: pass.toAgentId },
        projectAgentId: pass.toAgentId,
        correlationId: chainCorrelationId(chain),
        causationId: pass.id,
        occurredAt: now,
        payload: {
          chainId: pass.chainId,
          groupId: pass.groupId,
          passId: pass.id,
          targetPossessionId: possessionId,
          toAgentId: pass.toAgentId,
        },
      });
      return {
        pass: current,
        possession: possessionFromRow(this.getPossessionRow(possessionId)!),
      };
    }).immediate();
  }

  failPass(input: {
    passId: string;
    expectedRevision: number;
    status: Extract<PassStatus, 'blocked' | 'rejected' | 'timeout' | 'error'>;
    reasonCode: string;
    phase: string;
  }): A2AAggregatePass {
    const db = this.db();
    return db.transaction(() => {
      const pass = this.requireAggregatePass(input.passId);
      if (pass.revision !== input.expectedRevision) {
        throw new StaleA2ARevisionError(pass.id, input.expectedRevision, pass.revision);
      }
      if (!['offered', 'accepted', 'starting', 'started'].includes(pass.status)) {
        throw new A2ACollaborationInvariantError(
          'a2a_invalid_pass_transition',
          `${pass.status} -> ${input.status}`,
        );
      }
      const now = this.now().toISOString();
      const result = db.prepare(`
        UPDATE a2a_pass
        SET status=?,phase=?,reason=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=? AND status IN ('offered','accepted','starting','started')
      `).run(
        input.status,
        nonEmpty(input.phase, 'phase'),
        nonEmpty(input.reasonCode, 'reasonCode'),
        now,
        pass.id,
        input.expectedRevision,
      );
      if (result.changes !== 1) {
        throw new StaleA2ARevisionError(pass.id, input.expectedRevision, this.requirePassRow(pass.id)!.revision);
      }
      if (pass.targetPossessionId) {
        db.prepare(`
          UPDATE a2a_possession
          SET status=?,summary=?,completed_at=?,updated_at=?,revision=revision+1
          WHERE id=? AND status='open'
        `).run(
          input.status === 'timeout' ? 'timeout' : 'aborted',
          input.reasonCode,
          now,
          now,
          pass.targetPossessionId,
        );
      }
      const current = this.requireAggregatePass(pass.id);
      const chain = this.getChainRow(pass.chainId)!;
      new DomainEventPublisher(db).publish({
        type: 'a2a.pass.failed',
        projectId: chain.conversation_id,
        aggregate: { type: 'a2a_pass', id: pass.id, version: current.revision },
        actor: { type: 'system', id: 'a2a-collaboration' },
        subject: { type: 'agent', id: pass.toAgentId },
        correlationId: chainCorrelationId(chain),
        causationId: pass.id,
        occurredAt: now,
        payload: {
          chainId: pass.chainId,
          groupId: pass.groupId,
          passId: pass.id,
          toAgentId: pass.toAgentId,
          reasonCode: input.reasonCode,
        },
      });
      this.resolveGroupIfSettled(pass.groupId, now);
      return current;
    }).immediate();
  }

  completePossession(input: {
    possessionId: string;
    expectedRevision: number;
    summary: string;
  }): A2APossession & { parentPassId?: string; revision: number; updatedAt: string } {
    const db = this.db();
    return db.transaction(() => {
      const possession = this.getPossessionRow(input.possessionId);
      if (!possession) {
        throw new A2ACollaborationInvariantError('a2a_possession_missing', input.possessionId);
      }
      if (possession.revision !== input.expectedRevision) {
        throw new StaleA2ARevisionError(
          possession.id,
          input.expectedRevision,
          possession.revision,
        );
      }
      if (possession.status !== 'open') {
        throw new A2ACollaborationInvariantError(
          'a2a_possession_not_open',
          possession.id,
        );
      }
      const now = this.now().toISOString();
      db.prepare(`
        UPDATE a2a_possession
        SET status='completed',summary=?,completed_at=?,updated_at=?,revision=revision+1
        WHERE id=? AND status='open' AND revision=?
      `).run(input.summary.trim() || null, now, now, possession.id, input.expectedRevision);
      const chain = this.getChainRow(possession.chain_id)!;
      const completedPossession = this.getPossessionRow(possession.id)!;
      new DomainEventPublisher(db).publish({
        type: 'a2a.possession.completed',
        projectId: chain.conversation_id,
        aggregate: {
          type: 'a2a_possession',
          id: possession.id,
          version: completedPossession.revision,
        },
        actor: { type: possession.holder_type, id: possession.holder_id },
        correlationId: chainCorrelationId(chain),
        causationId: possession.parent_pass_id ?? possession.id,
        occurredAt: now,
        payload: {
          chainId: possession.chain_id,
          possessionId: possession.id,
          summary: input.summary.trim() || undefined,
        },
      });
      const parentPass = possession.parent_pass_id
        ? this.requirePassRow(possession.parent_pass_id)
        : undefined;
      if (parentPass) {
        const completedPass = db.prepare(`
          UPDATE a2a_pass
          SET status='completed',revision=revision+1,updated_at=?
          WHERE id=? AND status='started'
        `).run(now, parentPass.id);
        if (completedPass.changes === 1) {
          const currentPass = this.requireAggregatePass(parentPass.id);
          new DomainEventPublisher(db).publish({
            type: 'a2a.pass.completed',
            projectId: chain.conversation_id,
            aggregate: {
              type: 'a2a_pass',
              id: currentPass.id,
              version: currentPass.revision,
            },
            actor: { type: 'agent', id: possession.holder_id },
            subject: { type: 'agent', id: currentPass.fromHolderId },
            correlationId: chainCorrelationId(chain),
            causationId: possession.id,
            occurredAt: now,
            payload: {
              chainId: possession.chain_id,
              groupId: currentPass.groupId,
              passId: currentPass.id,
              targetPossessionId: possession.id,
            },
          });
        }
        if (parentPass.group_id) this.resolveGroupIfSettled(parentPass.group_id, now);
      }
      const recoveredGroup = db.prepare(`
        UPDATE a2a_pass_group
        SET status='completed',completed_at=?,updated_at=?,revision=revision+1
        WHERE recovery_possession_id=? AND status='recovering'
      `).run(now, now, possession.id);
      if (recoveredGroup.changes === 1) {
        const group = db.prepare(`
          SELECT * FROM a2a_pass_group WHERE recovery_possession_id=?
        `).get(possession.id) as GroupRow;
        new DomainEventPublisher(db).publish({
          type: 'a2a.pass.group_completed',
          projectId: chain.conversation_id,
          aggregate: {
            type: 'a2a_pass_group',
            id: group.id,
            version: group.revision,
          },
          actor: { type: possession.holder_type, id: possession.holder_id },
          correlationId: chainCorrelationId(chain),
          causationId: possession.id,
          occurredAt: now,
          payload: {
            chainId: possession.chain_id,
            groupId: group.id,
            recovered: true,
          },
        });
      }
      this.completeChainIfSettled(possession.chain_id, now);
      return possessionFromRow(this.getPossessionRow(possession.id)!);
    }).immediate();
  }

  getChain(chainId: string) {
    const row = this.getChainRow(chainId);
    return row ? chainFromRow(row) : undefined;
  }

  getPossession(possessionId: string) {
    const row = this.getPossessionRow(possessionId);
    return row ? possessionFromRow(row) : undefined;
  }

  getPass(passId: string): A2AAggregatePass | undefined {
    const row = this.requirePassRow(passId, false);
    return row?.group_id ? passFromRow(row) : undefined;
  }

  getGroup(groupId: string): A2APassGroup | undefined {
    const row = this.getGroupRow(groupId);
    return row ? groupFromRow(row) : undefined;
  }

  listOpenPossessions(chainId: string) {
    return (this.db().prepare(`
      SELECT * FROM a2a_possession
      WHERE chain_id=? AND status IN (
        'open','handoff_drafted','handoff_offered','handoff_accepted','handoff_started'
      )
      ORDER BY started_at,id
    `).all(chainId) as PossessionRow[]).map(possessionFromRow);
  }

  findOpenPossessionForHolder(
    conversationId: string,
    holderId: string,
  ): (A2APossession & { parentPassId?: string; revision: number; updatedAt: string }) | undefined {
    const rows = this.db().prepare(`
      SELECT possession.*
      FROM a2a_possession possession
      JOIN a2a_possession_chain chain ON chain.id=possession.chain_id
      WHERE chain.conversation_id=?
        AND chain.status='active'
        AND possession.holder_id=?
        AND possession.status='open'
      ORDER BY possession.started_at DESC,possession.id DESC
      LIMIT 2
    `).all(conversationId, holderId) as PossessionRow[];
    if (rows.length > 1) {
      throw new A2ACollaborationInvariantError(
        'a2a_source_possession_ambiguous',
        `${conversationId}:${holderId}`,
      );
    }
    return rows[0] ? possessionFromRow(rows[0]) : undefined;
  }

  private transitionPass(
    passId: string,
    from: PassStatus,
    to: PassStatus,
    expectedRevision: number,
  ): A2AAggregatePass {
    const db = this.db();
    return db.transaction(() => {
      const pass = this.requireAggregatePass(passId);
      if (pass.revision !== expectedRevision) {
        throw new StaleA2ARevisionError(pass.id, expectedRevision, pass.revision);
      }
      if (pass.status !== from) {
        throw new A2ACollaborationInvariantError(
          'a2a_invalid_pass_transition',
          `${pass.status} -> ${to}`,
        );
      }
      const now = this.now().toISOString();
      const result = db.prepare(`
        UPDATE a2a_pass
        SET status=?,revision=revision+1,updated_at=?
        WHERE id=? AND status=? AND revision=?
      `).run(to, now, pass.id, from, expectedRevision);
      if (result.changes !== 1) {
        throw new StaleA2ARevisionError(pass.id, expectedRevision, this.requirePassRow(pass.id)!.revision);
      }
      return this.requireAggregatePass(pass.id);
    }).immediate();
  }

  private resolveGroupIfSettled(groupId: string, now: string): void {
    const db = this.db();
    const group = this.getGroupRow(groupId);
    if (
      !group
      || ['recovering', 'completed', 'failed', 'cancelled'].includes(group.status)
    ) return;
    const passes = db.prepare(`
      SELECT * FROM a2a_pass WHERE group_id=? ORDER BY created_at,id
    `).all(groupId) as PassRow[];
    const resolved = passes.filter((pass) => RESOLVED_PASS_STATUSES.has(pass.status));
    const failures = passes.filter((pass) => FAILED_PASS_STATUSES.has(pass.status));
    if (resolved.length < group.expected_count) {
      db.prepare(`
        UPDATE a2a_pass_group
        SET status='active',resolved_count=?,revision=revision+1,updated_at=?
        WHERE id=? AND revision=?
      `).run(resolved.length, now, group.id, group.revision);
      return;
    }
    const source = this.getPossessionRow(group.source_possession_id);
    if (!source) {
      throw new A2ACollaborationInvariantError(
        'a2a_source_possession_missing',
        group.source_possession_id,
      );
    }
    db.prepare(`
      UPDATE a2a_possession
      SET status='completed',completed_at=COALESCE(completed_at,?),updated_at=?,
          revision=revision+1
      WHERE id=? AND status NOT IN ('completed','aborted','timeout')
    `).run(now, now, source.id);

    if (failures.length === 0) {
      db.prepare(`
        UPDATE a2a_pass_group
        SET status='completed',resolved_count=expected_count,revision=revision+1,
            updated_at=?,completed_at=?
        WHERE id=?
      `).run(now, now, group.id);
      const completedGroup = this.getGroupRow(group.id)!;
      const chain = this.getChainRow(source.chain_id)!;
      new DomainEventPublisher(db).publish({
        type: 'a2a.pass.group_completed',
        projectId: chain.conversation_id,
        aggregate: {
          type: 'a2a_pass_group',
          id: group.id,
          version: completedGroup.revision,
        },
        actor: { type: 'system', id: 'a2a-collaboration' },
        subject: { type: source.holder_type, id: source.holder_id },
        correlationId: chainCorrelationId(chain),
        causationId: group.id,
        occurredAt: now,
        payload: {
          chainId: source.chain_id,
          groupId: group.id,
          recovered: false,
        },
      });
      return;
    }
    const recoveryId = this.idFactory('a2a-possession');
    const failedSummary = JSON.stringify({
      reason: 'fan_out_branch_recovery',
      failed: failures.map((pass) => ({
        passId: pass.id,
        toAgentId: pass.to_agent_id,
        reasonCode: pass.reason,
      })),
    });
    db.prepare(`
      INSERT INTO a2a_possession (
        id,chain_id,holder_id,holder_type,status,parent_pass_id,revision,
        started_at,updated_at,completed_at,summary
      ) VALUES (?,?,?,?,'open',?,0,?,?,NULL,?)
    `).run(
      recoveryId,
      source.chain_id,
      source.holder_id,
      source.holder_type,
      failures[0]!.id,
      now,
      now,
      failedSummary,
    );
    db.prepare(`
      UPDATE a2a_pass_group
      SET status='recovering',resolved_count=expected_count,recovery_possession_id=?,
          revision=revision+1,updated_at=?
      WHERE id=?
    `).run(recoveryId, now, group.id);
    db.prepare(`
      UPDATE a2a_possession_chain
      SET current_holder_id=?,revision=revision+1,updated_at=?
      WHERE id=? AND status='active'
    `).run(source.holder_id, now, source.chain_id);
    const chain = this.getChainRow(source.chain_id)!;
    const recoveryEvent = new DomainEventPublisher(db).publish({
      type: 'a2a.pass.group_recovery_opened',
      projectId: chain.conversation_id,
      aggregate: { type: 'a2a_pass_group', id: group.id },
      actor: { type: 'system', id: 'a2a-collaboration' },
      subject: { type: source.holder_type, id: source.holder_id },
      correlationId: chainCorrelationId(chain),
      causationId: group.id,
      occurredAt: now,
      payload: {
        chainId: source.chain_id,
        groupId: group.id,
        recoveryPossessionId: recoveryId,
        failedPassIds: failures.map((pass) => pass.id),
      },
    });
    if (source.holder_type === 'agent' && group.source_work_id) {
      const contract = db.prepare(`
        SELECT task_id FROM work_contract
        WHERE work_id=?
        ORDER BY work_epoch DESC,created_at DESC
        LIMIT 1
      `).get(group.source_work_id) as { task_id: string | null } | undefined;
      this.inbox.enqueue({
        projectId: chain.conversation_id,
        projectAgentId: source.holder_id,
        idempotencyKey: `a2a-recovery:${group.id}:${recoveryId}`,
        sourceEvent: recoveryEvent,
        command: {
          source: 'a2a',
          workId: group.source_work_id,
          prompt: [
            'An A2A collaboration branch failed. Reconcile the completed branch results',
            'with the failures below, then choose a new structured outcome.',
            failedSummary,
          ].join('\n\n'),
          taskId: contract?.task_id ?? undefined,
          deliveryRunId: group.delivery_run_id ?? undefined,
          fromAgentId: 'a2a-collaboration',
          chainId: source.chain_id,
          contextScenario: 'recovery',
        },
      });
    }
  }

  private completeChainIfSettled(chainId: string, now: string): void {
    const db = this.db();
    const openPossession = db.prepare(`
      SELECT 1 FROM a2a_possession
      WHERE chain_id=? AND status IN (
        'open','handoff_drafted','handoff_offered','handoff_accepted','handoff_started'
      ) LIMIT 1
    `).get(chainId);
    const unresolvedPass = db.prepare(`
      SELECT 1 FROM a2a_pass
      WHERE chain_id=? AND status IN (
        'drafted','validated','offered','accepted','starting','started'
      ) LIMIT 1
    `).get(chainId);
    const unresolvedGroup = db.prepare(`
      SELECT 1 FROM a2a_pass_group
      WHERE chain_id=? AND status IN ('offered','active','recovering')
      LIMIT 1
    `).get(chainId);
    if (openPossession || unresolvedPass || unresolvedGroup) return;
    const chain = this.getChainRow(chainId);
    if (!chain || chain.status !== 'active') return;
    const result = db.prepare(`
      UPDATE a2a_possession_chain
      SET status='completed',completed_at=?,updated_at=?,revision=revision+1
      WHERE id=? AND status='active' AND revision=?
    `).run(now, now, chainId, chain.revision);
    if (result.changes !== 1) return;
    new DomainEventPublisher(db).publish({
      type: 'a2a.chain.completed',
      projectId: chain.conversation_id,
      aggregate: { type: 'a2a_collaboration', id: chainId, version: chain.revision + 1 },
      actor: { type: 'system', id: 'a2a-collaboration' },
      correlationId: chainCorrelationId(chain),
      causationId: chainId,
      occurredAt: now,
      payload: { status: 'completed' },
    });
  }

  private ancestry(source: PossessionRow): { holderIds: Set<string>; possessionIds: Set<string> } {
    const holderIds = new Set<string>();
    const possessionIds = new Set<string>();
    let current: PossessionRow | undefined = source;
    while (current && !possessionIds.has(current.id)) {
      possessionIds.add(current.id);
      holderIds.add(current.holder_id);
      if (!current.parent_pass_id) break;
      const parentPass = this.requirePassRow(current.parent_pass_id, false);
      current = parentPass ? this.getPossessionRow(parentPass.from_possession_id) : undefined;
    }
    return { holderIds, possessionIds };
  }

  private parentHopCount(source: PossessionRow): number {
    if (!source.parent_pass_id) return 0;
    return this.requirePassRow(source.parent_pass_id)!.hop_count;
  }

  private loadOfferedGroup(group: GroupRow, duplicate: boolean): OfferedPassGroup {
    const db = this.db();
    const passes = (db.prepare(`
      SELECT * FROM a2a_pass WHERE group_id=? ORDER BY created_at,id
    `).all(group.id) as PassRow[]).map(passFromRow);
    const packets = (db.prepare(`
      SELECT * FROM a2a_handoff_packet WHERE chain_id=? AND pass_id IN (
        SELECT id FROM a2a_pass WHERE group_id=?
      ) ORDER BY created_at,id
    `).all(group.chain_id, group.id) as PacketRow[]).map(packetFromRow);
    return {
      group: groupFromRow(group),
      passes,
      packets,
      inboxItems: passes.flatMap((pass) => {
        const item = pass.inboxItemId ? this.inbox.get(pass.inboxItemId) : undefined;
        return item ? [item] : [];
      }),
      duplicate,
    };
  }

  private getChainRow(chainId: string): ChainRow | undefined {
    return this.db().prepare('SELECT * FROM a2a_possession_chain WHERE id=?')
      .get(chainId) as ChainRow | undefined;
  }

  private getPossessionRow(possessionId: string): PossessionRow | undefined {
    return this.db().prepare('SELECT * FROM a2a_possession WHERE id=?')
      .get(possessionId) as PossessionRow | undefined;
  }

  private getGroupRow(groupId: string): GroupRow | undefined {
    return this.db().prepare('SELECT * FROM a2a_pass_group WHERE id=?')
      .get(groupId) as GroupRow | undefined;
  }

  private requirePassRow(passId: string, required = true): PassRow | undefined {
    const row = this.db().prepare('SELECT * FROM a2a_pass WHERE id=?')
      .get(passId) as PassRow | undefined;
    if (!row && required) {
      throw new A2ACollaborationInvariantError('a2a_pass_missing', passId);
    }
    return row;
  }

  private requireAggregatePass(passId: string): A2AAggregatePass {
    return passFromRow(this.requirePassRow(passId)!);
  }
}
