import type { A2AHandoffPacket, PassIntent } from './types-possession';
import { A2ACollaborationInvariantError } from './errors';

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

const PASS_INTENT_ALIASES: Readonly<Record<string, PassIntent>> = {
  quality_gate: 'verify',
};

export interface HandoffBranchInput {
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

export interface HandoffOutcomePayload {
  idempotencyKey: string;
  sourcePossessionId?: string;
  expectedSourceRevision?: number;
  maxHops?: number;
  branches: HandoffBranchInput[];
}

function invalid(field: string): never {
  throw new A2ACollaborationInvariantError('a2a_outcome_invalid', field);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(field);
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function stringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(field);
  return value.map((item) => item.trim()).filter(Boolean);
}

function passIntent(value: unknown, field: string): PassIntent {
  const submitted = requiredString(value, field);
  const normalized = PASS_INTENT_ALIASES[submitted] ?? (submitted as PassIntent);
  if (!PASS_INTENTS.has(normalized)) invalid(field);
  return normalized;
}

function evidenceFromString(reference: string, field: string): A2AHandoffPacket['evidenceRefs'][number] {
  const label = requiredString(reference, field);
  if (/^https?:\/\//i.test(label)) return { label, url: label };
  if (/^task:/i.test(label)) return { label, taskId: label.slice('task:'.length) };
  return { label, path: label };
}

function evidenceArray(
  value: unknown,
  fallback: string[],
): A2AHandoffPacket['evidenceRefs'] {
  if (value === undefined) {
    return fallback.map((reference, index) => (
      evidenceFromString(reference, `envelope.evidenceRefs[${index}]`)
    ));
  }
  if (!Array.isArray(value)) invalid('evidenceRefs');
  return value.map((item, index) => {
    if (typeof item === 'string') {
      return evidenceFromString(item, `evidenceRefs[${index}]`);
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      invalid(`evidenceRefs[${index}]`);
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

export function parseHandoffOutcome(
  value: unknown,
  envelopeEvidence: unknown,
): HandoffOutcomePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('payload');
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.branches) || record.branches.length === 0) {
    throw new A2ACollaborationInvariantError('a2a_pass_group_empty', 'branches');
  }
  if (record.branches.length > 3) {
    throw new A2ACollaborationInvariantError('a2a_pass_group_too_wide', 'branches');
  }
  const fallbackEvidence = stringArray(envelopeEvidence, 'envelope.evidenceRefs');
  const branches = record.branches.map((item, index): HandoffBranchInput => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) invalid(`branches[${index}]`);
    const branch = item as Record<string, unknown>;
    const intent = passIntent(branch.intent, `branches[${index}].intent`);
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
      openQuestions: stringArray(branch.openQuestions, `branches[${index}].openQuestions`),
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
  ) invalid('expectedSourceRevision');
  const maxHops = record.maxHops;
  if (maxHops !== undefined && (!Number.isSafeInteger(maxHops) || Number(maxHops) <= 0)) {
    invalid('maxHops');
  }
  const sourcePossessionId = optionalString(record.sourcePossessionId, 'sourcePossessionId');
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

export function parseHandoffOutcomeJson(
  payloadJson: string,
  evidenceRefsJson: string,
): HandoffOutcomePayload {
  try {
    return parseHandoffOutcome(JSON.parse(payloadJson), JSON.parse(evidenceRefsJson));
  } catch (error) {
    if (error instanceof A2ACollaborationInvariantError) throw error;
    throw new A2ACollaborationInvariantError('a2a_outcome_invalid', 'json');
  }
}
