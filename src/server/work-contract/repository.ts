import { timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { generateSortableId } from '../repositories/sortable-id';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { validateDeliveryGateReceipt } from '../quality-gate/delivery-receipt-validation';
import { continueGateLite } from './continue-gate';
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

function gateOutcomeRejectionReason(
  input: AgentOutcome,
  contract: WorkContractRow,
  db: ReturnType<typeof getDb>,
): string | undefined {
  if (input.outcomeType !== 'record_gate_decision') return undefined;
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return 'gate_outcome_payload_invalid';
  }
  const payload = input.payload as Record<string, unknown>;
  const gateId = typeof payload.gateId === 'string' ? payload.gateId.trim() : '';
  const evidenceType = typeof payload.evidenceType === 'string'
    ? payload.evidenceType.trim()
    : '';
  if (!gateId) return 'gate_outcome_gate_id_required';
  if (!evidenceType) return 'gate_outcome_evidence_type_required';
  if (
    !Object.prototype.hasOwnProperty.call(payload, 'evidence')
    || payload.evidence === null
    || payload.evidence === undefined
  ) return 'gate_outcome_evidence_required';
  if (!['passed', 'changes_requested', 'rejected'].includes(String(payload.decision))) {
    return 'gate_outcome_decision_invalid';
  }
  const gate = db.prepare(`
    SELECT conversation_id,target_type,target_id,kind
    FROM quality_gate
    WHERE id=?
  `).get(gateId) as {
    conversation_id: string;
    target_type: 'task' | 'delivery_run';
    target_id: string;
    kind: string;
  } | undefined;
  if (!gate) return 'gate_outcome_gate_missing';
  if (gate.conversation_id !== contract.project_id) return 'gate_outcome_project_mismatch';
  if (gate.target_type === 'task' && gate.target_id !== contract.task_id) {
    return 'gate_outcome_task_mismatch';
  }
  if (gate.target_type === 'delivery_run' && gate.target_id !== contract.delivery_run_id) {
    return 'gate_outcome_delivery_mismatch';
  }
  if (gate.target_type === 'delivery_run') {
    if (gate.kind !== 'delivery_review' && gate.kind !== 'acceptance_verification') {
      return 'gate_outcome_delivery_kind_invalid';
    }
    const snapshot = new AutonomousDeliveryRepository(db).getSnapshot(gate.target_id);
    if (!snapshot) return 'gate_outcome_delivery_missing';
    const validation = validateDeliveryGateReceipt({
      kind: gate.kind,
      runId: gate.target_id,
      agentId: contract.agent_id,
      decision: payload.decision as 'passed' | 'changes_requested' | 'rejected',
      receipt: payload.receipt,
      snapshot,
    });
    if (!validation.valid) return validation.reasonCode;
  }
  return undefined;
}

function continuationOutcomeRejectionReason(input: AgentOutcome): string | undefined {
  if (input.outcomeType !== 'continue_work') return undefined;
  const admission = continueGateLite.admit(input.payload);
  return admission.accepted ? undefined : admission.reasonCode;
}

function handoffOutcomeRejectionReason(input: AgentOutcome): string | undefined {
  if (input.outcomeType !== 'handoff_to_agent') return undefined;
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    return 'a2a_outcome_payload_invalid';
  }
  const branches = (input.payload as Record<string, unknown>).branches;
  if (!Array.isArray(branches) || branches.length === 0) {
    return 'a2a_pass_group_empty';
  }
  if (branches.length > 3) return 'a2a_pass_group_too_wide';
  return undefined;
}

function a2aPossessionOutcomeRejectionReason(
  contract: WorkContractRow,
  frozenRevisions: Record<string, string | number>,
  db: ReturnType<typeof getDb>,
): string | undefined {
  const refs = parseJson<string[]>(contract.authoritative_refs_json);
  const reference = refs.find((candidate) => /^(?:a2a_)?possession:/.test(candidate));
  if (!reference) return undefined;
  const possessionId = reference.replace(/^(?:a2a_)?possession:/, '');
  if (!possessionId) return 'a2a_possession_missing';
  const possession = db.prepare(`
    SELECT
      possession.revision,
      possession.status,
      possession.holder_id,
      chain.conversation_id
    FROM a2a_possession possession
    JOIN a2a_possession_chain chain ON chain.id=possession.chain_id
    WHERE possession.id=?
  `).get(possessionId) as {
    revision: number;
    status: string;
    holder_id: string;
    conversation_id: string;
  } | undefined;
  if (!possession) return 'a2a_possession_missing';
  if (possession.conversation_id !== contract.project_id) return 'a2a_possession_project_mismatch';
  if (possession.holder_id !== contract.agent_id) return 'a2a_possession_holder_mismatch';
  if (possession.status !== 'open') return 'a2a_possession_not_open';
  const frozenRevision = frozenRevisions.a2aPossession;
  if (
    typeof frozenRevision !== 'number'
    || !Number.isSafeInteger(frozenRevision)
    || possession.revision !== frozenRevision
  ) return 'a2a_possession_revision_stale';
  return undefined;
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

  private getContractRow(contractId: string): WorkContractRow | undefined {
    return getDb().prepare('SELECT * FROM work_contract WHERE id=?')
      .get(contractId) as WorkContractRow | undefined;
  }

  getAuthority(workId: string): WorkAuthorityRow | undefined {
    return getDb().prepare('SELECT * FROM work_authority WHERE work_id=?')
      .get(workId) as WorkAuthorityRow | undefined;
  }

  private listActiveAuthoritiesForTask(projectId: string, taskId: string): WorkAuthorityRow[] {
    return getDb().prepare(`
      SELECT authority.*
      FROM work_authority authority
      JOIN work_contract contract
        ON contract.id=authority.current_contract_id
      WHERE authority.project_id=?
        AND authority.status='active'
        AND contract.task_id=?
      ORDER BY authority.work_id
    `).all(projectId, taskId) as WorkAuthorityRow[];
  }

  closeActiveForTask(input: {
    projectId: string;
    taskId: string;
    correlationId: string;
    causationId: string;
    now?: Date;
  }): WorkAuthorityRow[] {
    const timestamp = input.now ?? new Date();
    const db = getDb();
    return db.transaction(() => this.listActiveAuthoritiesForTask(
      input.projectId,
      input.taskId,
    ).map((authority) => this.close({
      workId: authority.work_id,
      expectedEpoch: authority.current_epoch,
      correlationId: input.correlationId,
      causationId: input.causationId,
      now: timestamp,
    }))).immediate();
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
      const frozenRevisions = contract
        ? parseJson<Record<string, string | number>>(contract.authoritative_revisions_json)
        : {};
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
          frozenRevisions,
          input.authoritativeRevisions,
        )
      ) {
        rejectionReason = 'authoritative_revision_mismatch';
      } else if (contract.task_id) {
        const task = db.prepare('SELECT revision FROM task WHERE id=?')
          .get(contract.task_id) as { revision: number } | undefined;
        if (!task || task.revision !== frozenRevisions.task) {
          rejectionReason = 'task_authoritative_revision_stale';
        }
      }
      if (!rejectionReason && contract?.delivery_run_id) {
        const delivery = db.prepare('SELECT revision FROM autonomous_delivery_run WHERE id=?')
          .get(contract.delivery_run_id) as { revision: number } | undefined;
        if (!delivery || delivery.revision !== frozenRevisions.deliveryRun) {
          rejectionReason = 'delivery_authoritative_revision_stale';
        }
      }
      if (!rejectionReason && contract) {
        rejectionReason = continuationOutcomeRejectionReason(input)
          ?? handoffOutcomeRejectionReason(input)
          ?? a2aPossessionOutcomeRejectionReason(contract, frozenRevisions, db)
          ?? gateOutcomeRejectionReason(input, contract, db);
      }
      if (!rejectionReason && contract && contract.correlation_id !== input.correlationId) {
        rejectionReason = 'correlation_mismatch';
      } else if (!rejectionReason && contract && input.outcomeType === 'continue_work' && db.prepare(`
        SELECT 1 FROM agent_outcome
        WHERE contract_id=?
          AND admission_status='accepted'
          AND outcome_type='continue_work'
        LIMIT 1
      `).get(contract.id)) {
        rejectionReason = 'continuation_already_accepted';
      } else if (!rejectionReason && contract && db.prepare(`
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
      const eventCorrelationId = rejectionReason === 'correlation_mismatch' && contract
        ? contract.correlation_id
        : input.correlationId;
      new PlatformEventLog({ db }).append({
        type: rejectionReason ? 'agent.outcome.rejected' : 'agent.outcome.accepted',
        category: 'coordination',
        projectId: input.projectId,
        streamKey: `work:${input.workId}`,
        aggregate: { type: 'agent_outcome', id: input.outcomeId },
        actor: { type: 'agent', id: contract?.agent_id ?? 'unknown' },
        correlationId: eventCorrelationId,
        causationId: input.causationId,
        occurredAt: recordedAt,
        payload: {
          contractId: input.contractId,
          workEpoch: input.workEpoch,
          outcomeType: input.outcomeType,
          ...(rejectionReason === 'correlation_mismatch'
            ? { submittedCorrelationId: input.correlationId }
            : {}),
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
