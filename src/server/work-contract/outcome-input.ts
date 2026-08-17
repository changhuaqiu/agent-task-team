import { AGENT_OUTCOME_TYPES, type AgentOutcome, type AgentOutcomeType } from './types';

export class InvalidAgentOutcomeInputError extends Error {
  readonly reasonCode = 'invalid_agent_outcome_input';

  constructor(readonly field: string) {
    super(`Invalid AgentOutcome field: ${field}`);
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidAgentOutcomeInputError(field);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidAgentOutcomeInputError(field);
  }
  return value.trim();
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new InvalidAgentOutcomeInputError(field);
  }
  return value;
}

export function parseAgentOutcomeInput(value: unknown): AgentOutcome {
  const input = record(value, 'body');
  const outcomeType = text(input.outcomeType, 'outcomeType');
  if (!AGENT_OUTCOME_TYPES.includes(outcomeType as AgentOutcomeType)) {
    throw new InvalidAgentOutcomeInputError('outcomeType');
  }
  if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.some(
    (item) => typeof item !== 'string' || !item.trim(),
  )) {
    throw new InvalidAgentOutcomeInputError('evidenceRefs');
  }
  const revisions = record(input.authoritativeRevisions, 'authoritativeRevisions');
  if (Object.values(revisions).some(
    (revision) => typeof revision !== 'string' && typeof revision !== 'number',
  )) {
    throw new InvalidAgentOutcomeInputError('authoritativeRevisions');
  }
  const occurredAt = text(input.occurredAt, 'occurredAt');
  if (!Number.isFinite(Date.parse(occurredAt))) {
    throw new InvalidAgentOutcomeInputError('occurredAt');
  }
  if (outcomeType === 'record_gate_decision') {
    const payload = record(input.payload, 'payload');
    text(payload.gateId, 'payload.gateId');
    text(payload.evidenceType, 'payload.evidenceType');
    if (
      !Object.prototype.hasOwnProperty.call(payload, 'evidence')
      || payload.evidence === null
      || payload.evidence === undefined
    ) {
      throw new InvalidAgentOutcomeInputError('payload.evidence');
    }
    const decision = text(payload.decision, 'payload.decision');
    if (!['passed', 'changes_requested', 'rejected'].includes(decision)) {
      throw new InvalidAgentOutcomeInputError('payload.decision');
    }
  }
  return {
    outcomeId: text(input.outcomeId, 'outcomeId'),
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'),
    contractId: text(input.contractId, 'contractId'),
    outcomeType: outcomeType as AgentOutcomeType,
    payload: input.payload ?? {},
    evidenceRefs: input.evidenceRefs.map((item) => String(item).trim()),
    projectId: text(input.projectId, 'projectId'),
    workId: text(input.workId, 'workId'),
    workEpoch: positiveInteger(input.workEpoch, 'workEpoch'),
    attemptId: text(input.attemptId, 'attemptId'),
    fencingToken: text(input.fencingToken, 'fencingToken'),
    authoritativeRevisions: revisions as Record<string, string | number>,
    correlationId: text(input.correlationId, 'correlationId'),
    causationId: text(input.causationId, 'causationId'),
    occurredAt,
  };
}
