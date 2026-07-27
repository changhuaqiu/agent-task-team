import { timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { generateSortableId } from '../repositories/sortable-id';
import {
  AGENT_OUTCOME_TYPES,
  type AgentOutcome,
  type AgentOutcomeRow,
  type AgentOutcomeType,
  type WorkAuthorityRow,
  type WorkContract,
  type WorkContractRow,
} from './types';

const OUTCOME_TYPE_SET = new Set<string>(AGENT_OUTCOME_TYPES);

export type OutcomeAdmission =
  | { status: 'accepted'; outcome: AgentOutcomeRow }
  | { status: 'duplicate'; outcome: AgentOutcomeRow }
  | { status: 'rejected'; outcome: AgentOutcomeRow; reasonCode: string };

export class WorkContractInvariantError extends Error {
  readonly reasonCode = 'work_contract_invariant_failed';

  constructor(readonly detail: string) {
    super(detail);
  }
}

export class StaleWorkAuthorityError extends Error {
  readonly reasonCode = 'stale_work_authority';

  constructor(readonly workId: string, readonly expectedEpoch: number, readonly actualEpoch: number) {
    super(`Stale work authority for ${workId}: expected ${expectedEpoch}, actual ${actualEpoch}`);
  }
}

export class AgentOutcomeIdempotencyConflictError extends Error {
  readonly reasonCode = 'agent_outcome_idempotency_conflict';

  constructor(readonly idempotencyKey: string) {
    super(`AgentOutcome idempotency key is already bound to different content: ${idempotencyKey}`);
  }
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new WorkContractInvariantError(`${field} is required`);
  return normalized;
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function safeTokenEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function contractFromRow(row: WorkContractRow): WorkContract {
  return {
    contractId: row.id,
    workId: row.work_id,
    workEpoch: row.work_epoch,
    attemptId: row.attempt_id,
    fencingToken: row.fencing_token,
    projectId: row.project_id,
    taskId: row.task_id ?? undefined,
    deliveryRunId: row.delivery_run_id ?? undefined,
    agentId: row.agent_id,
    goal: row.goal,
    acceptanceCriteria: parseJson<string[]>(row.acceptance_criteria_json),
    role: parseJson(row.role_json),
    permissions: parseJson(row.permissions_json),
    authoritativeRefs: parseJson<string[]>(row.authoritative_refs_json),
    authoritativeRevisions: parseJson<Record<string, string | number>>(
      row.authoritative_revisions_json,
    ),
    contextSnapshotRef: row.context_snapshot_ref,
    allowedOutcomeTypes: parseJson<AgentOutcomeType[]>(row.allowed_outcome_types_json),
    deadlineAt: row.deadline_at ?? undefined,
    budget: parseJson(row.budget_json),
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    createdAt: row.created_at,
  };
}

function sameRevisions(
  expected: Record<string, string | number>,
  actual: Record<string, string | number>,
): boolean {
  const expectedEntries = Object.entries(expected).sort(([left], [right]) => left.localeCompare(right));
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(expectedEntries) === JSON.stringify(actualEntries);
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function duplicateMatches(row: AgentOutcomeRow, input: AgentOutcome): boolean {
  return row.contract_id === input.contractId
    && row.project_id === input.projectId
    && row.work_id === input.workId
    && row.work_epoch === input.workEpoch
    && row.attempt_id === input.attemptId
    && safeTokenEquals(row.fencing_token, input.fencingToken)
    && row.outcome_type === input.outcomeType
    && row.payload_json === canonicalJson(input.payload ?? {})
    && row.evidence_refs_json === canonicalJson(input.evidenceRefs)
    && row.authoritative_revisions_json === canonicalJson(input.authoritativeRevisions)
    && row.correlation_id === input.correlationId
    && row.causation_id === input.causationId;
}

export class WorkContractRepository {
  issue(input: {
    workId: string;
    attemptId: string;
    projectId: string;
    taskId?: string;
    deliveryRunId?: string;
    agentId: string;
    goal: string;
    acceptanceCriteria: string[];
    role: unknown;
    permissions: unknown;
    authoritativeRefs: string[];
    authoritativeRevisions: Record<string, string | number>;
    contextSnapshotRef: string;
    allowedOutcomeTypes: AgentOutcomeType[];
    deadlineAt?: string;
    budget?: unknown;
    correlationId: string;
    causationId: string;
    expectedCurrentEpoch?: number;
    now?: Date;
  }): WorkContract {
    const workId = requiredText(input.workId, 'workId');
    const attemptId = requiredText(input.attemptId, 'attemptId');
    const projectId = requiredText(input.projectId, 'projectId');
    const agentId = requiredText(input.agentId, 'agentId');
    const goal = requiredText(input.goal, 'goal');
    const contextSnapshotRef = requiredText(input.contextSnapshotRef, 'contextSnapshotRef');
    const correlationId = requiredText(input.correlationId, 'correlationId');
    const causationId = requiredText(input.causationId, 'causationId');
    const allowedOutcomeTypes = [...new Set(input.allowedOutcomeTypes)];
    const acceptanceCriteria = [...new Set(
      input.acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean),
    )];
    const authoritativeRefs = [...new Set(
      input.authoritativeRefs.map((reference) => reference.trim()).filter(Boolean),
    )];
    if (acceptanceCriteria.length === 0) {
      throw new WorkContractInvariantError('acceptanceCriteria must not be empty');
    }
    if (authoritativeRefs.length === 0) {
      throw new WorkContractInvariantError('authoritativeRefs must not be empty');
    }
    if (
      allowedOutcomeTypes.length === 0
      || allowedOutcomeTypes.some((type) => !OUTCOME_TYPE_SET.has(type))
    ) {
      throw new WorkContractInvariantError('allowedOutcomeTypes must contain supported outcomes');
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const authority = this.getAuthority(workId);
      const currentEpoch = authority?.current_epoch ?? 0;
      if (
        input.expectedCurrentEpoch !== undefined
        && input.expectedCurrentEpoch !== currentEpoch
      ) {
        throw new StaleWorkAuthorityError(workId, input.expectedCurrentEpoch, currentEpoch);
      }
      if (authority?.status === 'closed') {
        throw new WorkContractInvariantError(`Work ${workId} is closed`);
      }
      const workEpoch = currentEpoch + 1;
      const id = generateSortableId('work-contract');
      const fencingToken = generateSortableId('fence');
      db.prepare(`
        INSERT INTO work_contract (
          id,work_id,work_epoch,attempt_id,fencing_token,project_id,task_id,
          delivery_run_id,agent_id,goal,acceptance_criteria_json,role_json,
          permissions_json,authoritative_refs_json,authoritative_revisions_json,
          context_snapshot_ref,allowed_outcome_types_json,deadline_at,budget_json,
          correlation_id,causation_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        id,
        workId,
        workEpoch,
        attemptId,
        fencingToken,
        projectId,
        input.taskId ?? null,
        input.deliveryRunId ?? null,
        agentId,
        goal,
        JSON.stringify(acceptanceCriteria),
        JSON.stringify(input.role ?? {}),
        JSON.stringify(input.permissions ?? {}),
        JSON.stringify(authoritativeRefs),
        canonicalJson(input.authoritativeRevisions),
        contextSnapshotRef,
        JSON.stringify(allowedOutcomeTypes),
        input.deadlineAt ?? null,
        JSON.stringify(input.budget ?? {}),
        correlationId,
        causationId,
        timestamp,
      );
      db.prepare(`
        INSERT INTO work_authority (
          work_id,project_id,current_epoch,current_contract_id,status,revision,updated_at,closed_at
        ) VALUES (?,?,?,?,'active',0,?,NULL)
        ON CONFLICT(work_id) DO UPDATE SET
          current_epoch=excluded.current_epoch,
          current_contract_id=excluded.current_contract_id,
          status='active',
          revision=work_authority.revision+1,
          updated_at=excluded.updated_at,
          closed_at=NULL
      `).run(workId, projectId, workEpoch, id, timestamp);
      new PlatformEventLog({ db }).append({
        type: 'work.contract.issued',
        category: 'coordination',
        projectId,
        streamKey: `work:${workId}`,
        aggregate: { type: 'work_authority', id: workId, version: workEpoch },
        actor: { type: 'system', id: 'platform-harness' },
        subject: { type: 'agent', id: agentId },
        correlationId,
        causationId,
        occurredAt: timestamp,
        payload: { contractId: id, workEpoch, attemptId, contextSnapshotRef },
      });
      return contractFromRow(this.getContractRow(id)!);
    }).immediate();
  }

  getContractRow(contractId: string): WorkContractRow | undefined {
    return getDb().prepare('SELECT * FROM work_contract WHERE id=?')
      .get(contractId) as WorkContractRow | undefined;
  }

  getContract(contractId: string): WorkContract | undefined {
    const row = this.getContractRow(contractId);
    return row ? contractFromRow(row) : undefined;
  }

  getAuthority(workId: string): WorkAuthorityRow | undefined {
    return getDb().prepare('SELECT * FROM work_authority WHERE work_id=?')
      .get(workId) as WorkAuthorityRow | undefined;
  }

  close(input: {
    workId: string;
    expectedEpoch: number;
    correlationId: string;
    causationId: string;
    now?: Date;
  }): WorkAuthorityRow {
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const authority = this.getAuthority(input.workId);
      if (!authority) throw new WorkContractInvariantError(`Work not found: ${input.workId}`);
      if (authority.current_epoch !== input.expectedEpoch) {
        throw new StaleWorkAuthorityError(
          input.workId,
          input.expectedEpoch,
          authority.current_epoch,
        );
      }
      if (authority.status === 'closed') return authority;
      db.prepare(`
        UPDATE work_authority
        SET status='closed',revision=revision+1,updated_at=?,closed_at=?
        WHERE work_id=? AND current_epoch=? AND status='active'
      `).run(timestamp, timestamp, input.workId, input.expectedEpoch);
      const current = this.getAuthority(input.workId)!;
      new PlatformEventLog({ db }).append({
        type: 'work.authority.closed',
        category: 'coordination',
        projectId: current.project_id,
        streamKey: `work:${current.work_id}`,
        aggregate: {
          type: 'work_authority',
          id: current.work_id,
          version: current.current_epoch,
        },
        actor: { type: 'system', id: 'platform-harness' },
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: timestamp,
        payload: { contractId: current.current_contract_id, workEpoch: current.current_epoch },
      });
      return current;
    }).immediate();
  }

  admitOutcome(input: AgentOutcome, now: Date = new Date()): OutcomeAdmission {
    requiredText(input.outcomeId, 'outcomeId');
    requiredText(input.idempotencyKey, 'idempotencyKey');
    requiredText(input.contractId, 'contractId');
    requiredText(input.projectId, 'projectId');
    requiredText(input.workId, 'workId');
    requiredText(input.attemptId, 'attemptId');
    requiredText(input.fencingToken, 'fencingToken');
    requiredText(input.correlationId, 'correlationId');
    requiredText(input.causationId, 'causationId');
    if (!Number.isSafeInteger(input.workEpoch) || input.workEpoch <= 0) {
      throw new WorkContractInvariantError('workEpoch must be a positive integer');
    }
    if (!OUTCOME_TYPE_SET.has(input.outcomeType)) {
      throw new WorkContractInvariantError('outcomeType is unsupported');
    }
    if (
      !Array.isArray(input.evidenceRefs)
      || input.evidenceRefs.some((reference) => !reference.trim())
    ) {
      throw new WorkContractInvariantError('evidenceRefs must contain non-empty strings');
    }
    if (!Number.isFinite(Date.parse(input.occurredAt))) {
      throw new WorkContractInvariantError('occurredAt must be an ISO timestamp');
    }
    const db = getDb();
    return db.transaction((): OutcomeAdmission => {
      const duplicate = db.prepare(
        'SELECT * FROM agent_outcome WHERE project_id=? AND idempotency_key=?',
      ).get(input.projectId, input.idempotencyKey) as AgentOutcomeRow | undefined;
      if (duplicate) {
        if (!duplicateMatches(duplicate, input)) {
          throw new AgentOutcomeIdempotencyConflictError(input.idempotencyKey);
        }
        return { status: 'duplicate', outcome: duplicate };
      }

      const contract = this.getContractRow(input.contractId);
      const authority = this.getAuthority(input.workId);
      let rejectionReason: string | undefined;
      if (!contract) rejectionReason = 'work_contract_missing';
      else if (contract.project_id !== input.projectId) rejectionReason = 'project_scope_mismatch';
      else if (contract.work_id !== input.workId) rejectionReason = 'work_identity_mismatch';
      else if (contract.work_epoch !== input.workEpoch) rejectionReason = 'work_epoch_mismatch';
      else if (contract.attempt_id !== input.attemptId) rejectionReason = 'attempt_mismatch';
      else if (!safeTokenEquals(contract.fencing_token, input.fencingToken)) {
        rejectionReason = 'fencing_token_mismatch';
      } else if (
        !authority
        || authority.status !== 'active'
        || authority.current_contract_id !== contract.id
        || authority.current_epoch !== contract.work_epoch
      ) {
        rejectionReason = 'work_authority_stale';
      } else if (
        !parseJson<AgentOutcomeType[]>(contract.allowed_outcome_types_json)
          .includes(input.outcomeType)
      ) {
        rejectionReason = 'outcome_type_not_allowed';
      } else if (
        !sameRevisions(
          parseJson<Record<string, string | number>>(contract.authoritative_revisions_json),
          input.authoritativeRevisions,
        )
      ) {
        rejectionReason = 'authoritative_revision_mismatch';
      } else if (contract.correlation_id !== input.correlationId) {
        rejectionReason = 'correlation_mismatch';
      } else if (db.prepare(`
        SELECT 1 FROM agent_outcome
        WHERE contract_id=?
          AND admission_status='accepted'
          AND outcome_type<>'continue_work'
        LIMIT 1
      `).get(contract.id)) {
        rejectionReason = 'terminal_outcome_already_accepted';
      }
      const recordedAt = now.toISOString();
      db.prepare(`
        INSERT INTO agent_outcome (
          id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,
          fencing_token,outcome_type,payload_json,evidence_refs_json,
          authoritative_revisions_json,correlation_id,causation_id,occurred_at,
          admission_status,rejection_reason,recorded_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        input.outcomeId,
        input.idempotencyKey,
        input.contractId,
        input.projectId,
        input.workId,
        input.workEpoch,
        input.attemptId,
        input.fencingToken,
        input.outcomeType,
        canonicalJson(input.payload ?? {}),
        canonicalJson(input.evidenceRefs),
        canonicalJson(input.authoritativeRevisions),
        input.correlationId,
        input.causationId,
        input.occurredAt,
        rejectionReason ? 'rejected' : 'accepted',
        rejectionReason ?? null,
        recordedAt,
      );
      const outcome = db.prepare('SELECT * FROM agent_outcome WHERE id=?')
        .get(input.outcomeId) as AgentOutcomeRow;
      new PlatformEventLog({ db }).append({
        type: rejectionReason ? 'agent.outcome.rejected' : 'agent.outcome.accepted',
        category: 'coordination',
        projectId: input.projectId,
        streamKey: `work:${input.workId}`,
        aggregate: { type: 'agent_outcome', id: input.outcomeId },
        actor: { type: 'agent', id: contract?.agent_id ?? 'unknown' },
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: recordedAt,
        payload: {
          contractId: input.contractId,
          workEpoch: input.workEpoch,
          outcomeType: input.outcomeType,
          ...(rejectionReason ? { reasonCode: rejectionReason } : {}),
        },
      });
      return rejectionReason
        ? { status: 'rejected', outcome, reasonCode: rejectionReason }
        : { status: 'accepted', outcome };
    }).immediate();
  }
}

export const workContractRepo = new WorkContractRepository();
