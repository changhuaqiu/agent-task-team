import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import {
  A2AIdempotencyConflictError,
  A2ACollaborationInvariantError,
  A2ACollaborationRepository,
  a2aPassGroupRequestDigest,
} from './collaboration';
import { A2ACommandGuard } from './command-guard';
import { parseHandoffOutcomeJson } from './handoff-outcome';

function passIdFromContract(contract: WorkContractRow): string | undefined {
  const refs = JSON.parse(contract.authoritative_refs_json) as unknown;
  if (!Array.isArray(refs)) return undefined;
  for (const reference of refs) {
    if (typeof reference !== 'string') continue;
    const match = /^(?:a2a_)?pass:(.+)$/.exec(reference);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function possessionIdFromContract(contract: WorkContractRow): string | undefined {
  const refs = JSON.parse(contract.authoritative_refs_json) as unknown;
  if (!Array.isArray(refs)) return undefined;
  for (const reference of refs) {
    if (typeof reference !== 'string') continue;
    const match = /^(?:a2a_)?possession:(.+)$/.exec(reference);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function outcomeSummary(outcome: AgentOutcomeRow): string {
  try {
    const payload = JSON.parse(outcome.payload_json) as unknown;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const summary = (payload as Record<string, unknown>).summary;
      if (typeof summary === 'string' && summary.trim()) return summary.trim();
    }
  } catch {
    // Admission already preserved the original payload; use the outcome type as a safe summary.
  }
  return outcome.outcome_type;
}

function outcomeReasonCode(outcome: AgentOutcomeRow): string {
  try {
    const payload = JSON.parse(outcome.payload_json) as unknown;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const record = payload as Record<string, unknown>;
      for (const candidate of [record.reasonCode, record.reason]) {
        if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      }
    }
  } catch {
    // Admission preserved the original payload; use the stable outcome fallback.
  }
  return outcome.outcome_type === 'request_human_decision'
    ? 'human_decision_requested'
    : 'agent_reported_blocked';
}

export function applyAcceptedA2AHandoff(input: {
  db: Database.Database;
  outcome: AgentOutcomeRow;
  contract: WorkContractRow;
  collaboration?: A2ACollaborationRepository;
  commandGuard?: Pick<A2ACommandGuard, 'assert'>;
}): void {
  const collaboration = input.collaboration ?? new A2ACollaborationRepository({ db: input.db });
  const commandGuard = input.commandGuard ?? new A2ACommandGuard();
  const payload = parseHandoffOutcomeJson(
    input.outcome.payload_json,
    input.outcome.evidence_refs_json,
  );
  const superseded = input.db.prepare(`
    SELECT 1 FROM agent_outcome
    WHERE work_id=? AND admission_status='accepted'
      AND (
        work_epoch>?
        OR (work_epoch=? AND recorded_at>? AND id<>?)
      )
    LIMIT 1
  `).get(
    input.outcome.work_id,
    input.outcome.work_epoch,
    input.outcome.work_epoch,
    input.outcome.recorded_at,
    input.outcome.id,
  );
  if (superseded) return;
  const branches = payload.branches.map((branch) => ({
    toAgentId: branch.toAgentId,
    intent: branch.intent,
    taskId: branch.taskId ?? input.contract.task_id ?? undefined,
    packet: {
      title: branch.title,
      requestedAction: branch.requestedAction,
      possessionSummary: branch.possessionSummary ?? branch.requestedAction,
      relevantDecisions: branch.relevantDecisions,
      evidenceRefs: branch.evidenceRefs,
      constraints: branch.constraints,
      openQuestions: branch.openQuestions,
      forbiddenBehaviors: branch.forbiddenBehaviors,
      sourceMessageIds: branch.sourceMessageIds.length > 0
        ? branch.sourceMessageIds
        : [input.outcome.causation_id],
    },
  }));
  const existingGroup = input.db.prepare(`
    SELECT id,chain_id,source_possession_id,request_digest,
           source_work_epoch,source_outcome_id
    FROM a2a_pass_group
    WHERE source_work_id=? AND idempotency_key=?
    LIMIT 1
  `).get(input.contract.work_id, payload.idempotencyKey) as {
    id: string;
    chain_id: string;
    source_possession_id: string;
    request_digest: string;
    source_work_epoch: number | null;
    source_outcome_id: string | null;
  } | undefined;
  if (existingGroup) {
    const replayDigest = a2aPassGroupRequestDigest({
      chainId: existingGroup.chain_id,
      sourcePossessionId: existingGroup.source_possession_id,
      sourceWorkId: input.contract.work_id,
      deliveryRunId: input.contract.delivery_run_id ?? undefined,
      branches,
    });
    if (replayDigest !== existingGroup.request_digest) {
      throw new A2AIdempotencyConflictError(payload.idempotencyKey);
    }
    if (existingGroup.source_outcome_id) {
      if (
        existingGroup.source_outcome_id !== input.outcome.id
        || existingGroup.source_work_epoch !== input.outcome.work_epoch
      ) {
        throw new A2AIdempotencyConflictError(payload.idempotencyKey);
      }
      return;
    }
    const legacyOrigin = input.db.prepare(`
      SELECT id,work_epoch
      FROM agent_outcome
      WHERE work_id=?
        AND admission_status='accepted'
        AND outcome_type='handoff_to_agent'
        AND json_valid(payload_json)=1
        AND json_extract(payload_json,'$.idempotencyKey')=?
      ORDER BY work_epoch,recorded_at,id
      LIMIT 1
    `).get(input.outcome.work_id, payload.idempotencyKey) as {
      id: string;
      work_epoch: number;
    } | undefined;
    if (
      !legacyOrigin
      || legacyOrigin.id !== input.outcome.id
      || legacyOrigin.work_epoch !== input.outcome.work_epoch
    ) {
      throw new A2AIdempotencyConflictError(payload.idempotencyKey);
    }
    const bound = input.db.prepare(`
      UPDATE a2a_pass_group
      SET source_work_epoch=?,source_outcome_id=?,updated_at=?
      WHERE id=? AND source_outcome_id IS NULL
    `).run(
      input.outcome.work_epoch,
      input.outcome.id,
      input.outcome.recorded_at,
      existingGroup.id,
    );
    if (bound.changes !== 1) {
      throw new A2AIdempotencyConflictError(payload.idempotencyKey);
    }
    return;
  }

  commandGuard.assert({
    conversationId: input.contract.project_id,
    fromHolderId: input.contract.agent_id,
    fromHolderType: 'agent',
    branches: payload.branches,
  });

  let source = payload.sourcePossessionId
    ? collaboration.getPossession(payload.sourcePossessionId)
    : undefined;
  if (payload.sourcePossessionId && !source) {
    throw new A2ACollaborationInvariantError(
      'a2a_source_possession_missing',
      payload.sourcePossessionId,
    );
  }
  if (!source) {
    const boundPossessionId = possessionIdFromContract(input.contract);
    source = boundPossessionId
      ? collaboration.getPossession(boundPossessionId)
      : undefined;
    if (boundPossessionId && !source) {
      throw new A2ACollaborationInvariantError('a2a_possession_missing', boundPossessionId);
    }
  }
  if (!source) {
    const parentPassId = passIdFromContract(input.contract);
    const parentPass = parentPassId ? collaboration.getPass(parentPassId) : undefined;
    source = parentPass?.targetPossessionId
      ? collaboration.getPossession(parentPass.targetPossessionId)
      : collaboration.findOpenPossessionForHolder(
        input.contract.project_id,
        input.contract.agent_id,
      );
  }
  if (!source) {
    source = collaboration.createChain({
      conversationId: input.contract.project_id,
      rootTriggerType: 'system',
      rootTriggerId: input.outcome.id,
      correlationId: input.contract.correlation_id,
      holderId: input.contract.agent_id,
      holderType: 'agent',
      config: payload.maxHops ? { maxDepth: payload.maxHops } : {},
    }).rootPossession;
  }
  if (source.holderId !== input.contract.agent_id) {
    throw new A2ACollaborationInvariantError(
      'a2a_source_holder_mismatch',
      `${source.holderId}:${input.contract.agent_id}`,
    );
  }
  if (
    payload.expectedSourceRevision !== undefined
    && payload.expectedSourceRevision !== source.revision
  ) {
    throw new A2ACollaborationInvariantError(
      'a2a_source_revision_mismatch',
      `${payload.expectedSourceRevision}:${source.revision}`,
    );
  }
  collaboration.offerPassGroup({
    chainId: source.chainId,
    sourcePossessionId: source.id,
    sourceWorkId: input.contract.work_id,
    sourceWorkEpoch: input.outcome.work_epoch,
    sourceOutcomeId: input.outcome.id,
    deliveryRunId: input.contract.delivery_run_id ?? undefined,
    expectedSourceRevision: source.revision,
    idempotencyKey: payload.idempotencyKey,
    maxHops: payload.maxHops,
    branches,
  });
}

export interface A2AOutcomeProcessManagerOptions {
  db?: Database.Database;
  collaboration?: A2ACollaborationRepository;
  commandGuard?: Pick<A2ACommandGuard, 'assert'>;
}

export class A2AOutcomeProcessManager {
  private readonly database?: Database.Database;
  private readonly collaboration: A2ACollaborationRepository;
  private readonly commandGuard: Pick<A2ACommandGuard, 'assert'>;

  constructor(options: A2AOutcomeProcessManagerOptions = {}) {
    this.database = options.db;
    this.collaboration = options.collaboration
      ?? new A2ACollaborationRepository({ db: options.db });
    this.commandGuard = options.commandGuard ?? new A2ACommandGuard();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('a2a_outcome_processing_aborted');
    const db = this.database ?? getDb();
    const outcome = db.prepare(`
      SELECT * FROM agent_outcome
      WHERE id=? AND admission_status='accepted'
    `).get(event.aggregate.id) as AgentOutcomeRow | undefined;
    if (!outcome) return;
    const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
      .get(outcome.contract_id) as WorkContractRow | undefined;
    if (!contract) {
      throw new A2ACollaborationInvariantError(
        'a2a_work_contract_missing',
        outcome.contract_id,
      );
    }
    if (outcome.outcome_type !== 'handoff_to_agent') {
      if (outcome.outcome_type === 'continue_work') return;
      const boundPossessionId = possessionIdFromContract(contract);
      const boundPossession = boundPossessionId
        ? this.collaboration.getPossession(boundPossessionId)
        : undefined;
      if (boundPossessionId && !boundPossession) {
        throw new A2ACollaborationInvariantError(
          'a2a_possession_missing',
          boundPossessionId,
        );
      }
      if (boundPossession && boundPossession.holderId !== contract.agent_id) {
        throw new A2ACollaborationInvariantError(
          'a2a_source_holder_mismatch',
          `${boundPossession.holderId}:${contract.agent_id}`,
        );
      }
      const parentPassId = passIdFromContract(contract);
      const parentPass = parentPassId
        ? this.collaboration.getPass(parentPassId)
        : undefined;
      const possession = boundPossession ?? (parentPass?.targetPossessionId
        ? this.collaboration.getPossession(parentPass.targetPossessionId)
        : undefined);
      if (
        parentPass
        && possession?.status === 'open'
        && (
          outcome.outcome_type === 'report_blocked'
          || outcome.outcome_type === 'request_human_decision'
        )
        && ['offered', 'accepted', 'starting', 'started'].includes(parentPass.status)
      ) {
        this.collaboration.failPass({
          passId: parentPass.id,
          expectedRevision: parentPass.revision,
          status: 'blocked',
          reasonCode: outcomeReasonCode(outcome),
          phase: 'run',
        });
      } else if (possession?.status === 'open') {
        this.collaboration.completePossession({
          possessionId: possession.id,
          expectedRevision: possession.revision,
          summary: outcomeSummary(outcome),
        });
      }
      return;
    }
    applyAcceptedA2AHandoff({
      db,
      outcome,
      contract,
      collaboration: this.collaboration,
      commandGuard: this.commandGuard,
    });
  };
}
