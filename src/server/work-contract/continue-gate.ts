export const CONTINUATION_REASONS = [
  'multi_step',
  'context_boundary',
  'verification_follow_up',
] as const;

export type ContinuationReason = (typeof CONTINUATION_REASONS)[number];

export interface WorkContinuationCheckpoint {
  schemaVersion: 1;
  reason: ContinuationReason;
  summary: string;
  nextAction: string;
  completedSteps: string[];
  remainingSteps: string[];
}

export type ContinuationAdmission =
  | { accepted: true; checkpoint: WorkContinuationCheckpoint }
  | { accepted: false; reasonCode: string };

export type ContinueGateDecision =
  | { disposition: 'continue'; reasonCode: 'agent_requested_continuation' }
  | { disposition: 'escalate'; reasonCode: 'continuation_budget_exhausted' }
  | { disposition: 'ignore'; reasonCode: 'continuation_not_requested' };

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value.map(nonEmptyString);
  if (normalized.some((item) => item === undefined)) return undefined;
  return normalized as string[];
}

/**
 * Owns the complete interpretation of an Agent-requested Work continuation.
 * Admission and scheduling use the same module so a checkpoint cannot be
 * accepted under one schema and interpreted under another.
 */
export class ContinueGateLite {
  admit(payload: unknown): ContinuationAdmission {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { accepted: false, reasonCode: 'continuation_payload_invalid' };
    }
    const record = payload as Record<string, unknown>;
    if (record.schemaVersion !== 1) {
      return { accepted: false, reasonCode: 'continuation_schema_version_invalid' };
    }
    if (!CONTINUATION_REASONS.includes(record.reason as ContinuationReason)) {
      return { accepted: false, reasonCode: 'continuation_reason_invalid' };
    }
    const summary = nonEmptyString(record.summary);
    if (!summary) return { accepted: false, reasonCode: 'continuation_summary_required' };
    const nextAction = nonEmptyString(record.nextAction);
    if (!nextAction) return { accepted: false, reasonCode: 'continuation_next_action_required' };
    const completedSteps = stringArray(record.completedSteps);
    if (!completedSteps) {
      return { accepted: false, reasonCode: 'continuation_completed_steps_invalid' };
    }
    const remainingSteps = stringArray(record.remainingSteps);
    if (!remainingSteps?.length) {
      return { accepted: false, reasonCode: 'continuation_remaining_steps_required' };
    }
    return {
      accepted: true,
      checkpoint: {
        schemaVersion: 1,
        reason: record.reason as ContinuationReason,
        summary,
        nextAction,
        completedSteps,
        remainingSteps,
      },
    };
  }

  decide(input: {
    requested: boolean;
    continuationsUsed: number;
    maxContinuations: number;
  }): ContinueGateDecision {
    if (!input.requested) {
      return { disposition: 'ignore', reasonCode: 'continuation_not_requested' };
    }
    if (
      !Number.isSafeInteger(input.continuationsUsed)
      || input.continuationsUsed < 0
      || !Number.isSafeInteger(input.maxContinuations)
      || input.maxContinuations < 1
    ) {
      throw new Error('continuation_budget_invalid');
    }
    return input.continuationsUsed <= input.maxContinuations
      ? { disposition: 'continue', reasonCode: 'agent_requested_continuation' }
      : { disposition: 'escalate', reasonCode: 'continuation_budget_exhausted' };
  }
}

export const continueGateLite = new ContinueGateLite();
