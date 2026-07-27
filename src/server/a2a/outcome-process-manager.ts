import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import {
  A2ACollaborationInvariantError,
  A2ACollaborationRepository,
} from './collaboration';
import { A2ACommandGuard } from './command-guard';
import type { A2AHandoffPacket, PassIntent } from './types-possession';

const PASS_INTENTS = new Set<PassIntent>([
  'delegate',
  'review',
  'answer',
  'verify',
  'implement',
  'plan',
  'reject',
  'escalate',
  'coord',
  'handoff_test',
]);

interface HandoffBranchInput {
  toAgentId: string;
  intent: PassIntent;
  taskId?: string;
  title: string;
  requestedAction: string;
  possessionSummary?: string;
  relevantDecisions: string[];
  evidenceRefs: A2AHandoffPacket['evidenceRefs'];
  constraints: string[];
  openQuestions: string[];
  forbiddenBehaviors: string[];
  sourceMessageIds: string[];
}

interface HandoffOutcomePayload {
  idempotencyKey: string;
  sourcePossessionId?: string;
  expectedSourceRevision?: number;
  maxHops?: number;
  branches: HandoffBranchInput[];
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', field);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', field);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function evidenceArray(
  value: unknown,
  fallback: string[],
): A2AHandoffPacket['evidenceRefs'] {
  if (value === undefined) {
    return fallback.map((reference) => ({ label: reference, path: reference }));
  }
  if (!Array.isArray(value)) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'evidenceRefs');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new A2ACollaborationInvariantError(
        'a2a_outcome_invalid',
        `evidenceRefs[${index}]`,
      );
    }
    const record = item as Record<string, unknown>;
    const path = optionalString(record.path, `evidenceRefs[${index}].path`);
    const taskId = optionalString(record.taskId, `evidenceRefs[${index}].taskId`);
    const url = optionalString(record.url, `evidenceRefs[${index}].url`);
    return {
      label: requiredString(record.label, `evidenceRefs[${index}].label`),
      ...(path ? { path } : {}),
      ...(taskId ? { taskId } : {}),
      ...(url ? { url } : {}),
    };
  });
}

function parsePayload(payloadJson: string, evidenceRefsJson: string): HandoffOutcomePayload {
  let value: unknown;
  let envelopeEvidence: unknown;
  try {
    value = JSON.parse(payloadJson);
    envelopeEvidence = JSON.parse(evidenceRefsJson);
  } catch {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'payload');
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.branches) || record.branches.length === 0) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'branches');
  }
  const fallbackEvidence = stringArray(envelopeEvidence, 'envelope.evidenceRefs');
  const branches = record.branches.map((item, index): HandoffBranchInput => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new A2ACollaborationInvariantError(
        'a2a_outcome_invalid',
        `branches[${index}]`,
      );
    }
    const branch = item as Record<string, unknown>;
    const intent = requiredString(branch.intent, `branches[${index}].intent`) as PassIntent;
    if (!PASS_INTENTS.has(intent)) {
      throw new A2ACollaborationInvariantError(
        'a2a_outcome_invalid',
        `branches[${index}].intent`,
      );
    }
    const taskId = optionalString(branch.taskId, `branches[${index}].taskId`);
    const possessionSummary = optionalString(
      branch.possessionSummary,
      `branches[${index}].possessionSummary`,
    );
    return {
      toAgentId: requiredString(branch.toAgentId, `branches[${index}].toAgentId`),
      intent,
      ...(taskId ? { taskId } : {}),
      title: requiredString(branch.title, `branches[${index}].title`),
      requestedAction: requiredString(
        branch.requestedAction,
        `branches[${index}].requestedAction`,
      ),
      ...(possessionSummary ? { possessionSummary } : {}),
      relevantDecisions: stringArray(
        branch.relevantDecisions,
        `branches[${index}].relevantDecisions`,
      ),
      evidenceRefs: evidenceArray(branch.evidenceRefs, fallbackEvidence),
      constraints: stringArray(branch.constraints, `branches[${index}].constraints`),
      openQuestions: stringArray(
        branch.openQuestions,
        `branches[${index}].openQuestions`,
      ),
      forbiddenBehaviors: stringArray(
        branch.forbiddenBehaviors,
        `branches[${index}].forbiddenBehaviors`,
      ),
      sourceMessageIds: stringArray(
        branch.sourceMessageIds,
        `branches[${index}].sourceMessageIds`,
      ),
    };
  });
  const expectedSourceRevision = record.expectedSourceRevision;
  if (
    expectedSourceRevision !== undefined
    && (!Number.isSafeInteger(expectedSourceRevision) || Number(expectedSourceRevision) < 0)
  ) {
    throw new A2ACollaborationInvariantError(
      'a2a_outcome_invalid',
      'expectedSourceRevision',
    );
  }
  const maxHops = record.maxHops;
  if (
    maxHops !== undefined
    && (!Number.isSafeInteger(maxHops) || Number(maxHops) <= 0)
  ) {
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'maxHops');
  }
  const sourcePossessionId = optionalString(
    record.sourcePossessionId,
    'sourcePossessionId',
  );
  return {
    idempotencyKey: requiredString(record.idempotencyKey, 'idempotencyKey'),
    ...(sourcePossessionId ? { sourcePossessionId } : {}),
    ...(expectedSourceRevision === undefined
      ? {}
      : { expectedSourceRevision: Number(expectedSourceRevision) }),
    ...(maxHops === undefined ? {} : { maxHops: Number(maxHops) }),
    branches,
  };
}

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
      const parentPassId = passIdFromContract(contract);
      const parentPass = parentPassId
        ? this.collaboration.getPass(parentPassId)
        : undefined;
      const possession = parentPass?.targetPossessionId
        ? this.collaboration.getPossession(parentPass.targetPossessionId)
        : undefined;
      if (possession?.status === 'open') {
        this.collaboration.completePossession({
          possessionId: possession.id,
          expectedRevision: possession.revision,
          summary: outcomeSummary(outcome),
        });
      }
      return;
    }
    const payload = parsePayload(outcome.payload_json, outcome.evidence_refs_json);
    this.commandGuard.assert({
      conversationId: contract.project_id,
      fromHolderId: contract.agent_id,
      fromHolderType: 'agent',
      branches: payload.branches,
    });

    let source = payload.sourcePossessionId
      ? this.collaboration.getPossession(payload.sourcePossessionId)
      : undefined;
    if (payload.sourcePossessionId && !source) {
      throw new A2ACollaborationInvariantError(
        'a2a_source_possession_missing',
        payload.sourcePossessionId,
      );
    }
    if (!source) {
      const parentPassId = passIdFromContract(contract);
      const parentPass = parentPassId
        ? this.collaboration.getPass(parentPassId)
        : undefined;
      source = parentPass?.targetPossessionId
        ? this.collaboration.getPossession(parentPass.targetPossessionId)
        : this.collaboration.findOpenPossessionForHolder(
          contract.project_id,
          contract.agent_id,
        );
    }
    if (!source) {
      source = this.collaboration.createChain({
        conversationId: contract.project_id,
        rootTriggerType: 'system',
        rootTriggerId: outcome.id,
        holderId: contract.agent_id,
        holderType: 'agent',
        config: payload.maxHops ? { maxDepth: payload.maxHops } : {},
      }).rootPossession;
    }
    if (source.holderId !== contract.agent_id) {
      throw new A2ACollaborationInvariantError(
        'a2a_source_holder_mismatch',
        `${source.holderId}:${contract.agent_id}`,
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
    this.collaboration.offerPassGroup({
      chainId: source.chainId,
      sourcePossessionId: source.id,
      sourceWorkId: contract.work_id,
      deliveryRunId: contract.delivery_run_id ?? undefined,
      expectedSourceRevision: source.revision,
      idempotencyKey: payload.idempotencyKey,
      maxHops: payload.maxHops,
      branches: payload.branches.map((branch) => ({
        toAgentId: branch.toAgentId,
        intent: branch.intent,
        taskId: branch.taskId ?? contract.task_id ?? undefined,
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
            : [outcome.causation_id],
        },
      })),
    });
  };
}
