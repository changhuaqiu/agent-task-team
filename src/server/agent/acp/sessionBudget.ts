export interface AcpSessionContextBudget {
  maxCumulativeInputTokens: number;
  maxTerminatedInvocations: number;
}

export const DEFAULT_ACP_SESSION_CONTEXT_BUDGET: AcpSessionContextBudget = {
  maxCumulativeInputTokens: 120_000,
  maxTerminatedInvocations: 12,
};

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveAcpSessionContextBudget(
  env: Record<string, string | undefined> = process.env,
): AcpSessionContextBudget {
  return {
    maxCumulativeInputTokens: positiveInteger(
      env.ACP_SESSION_MAX_CUMULATIVE_INPUT_TOKENS,
      DEFAULT_ACP_SESSION_CONTEXT_BUDGET.maxCumulativeInputTokens,
    ),
    maxTerminatedInvocations: positiveInteger(
      env.ACP_SESSION_MAX_TERMINATED_INVOCATIONS,
      DEFAULT_ACP_SESSION_CONTEXT_BUDGET.maxTerminatedInvocations,
    ),
  };
}
