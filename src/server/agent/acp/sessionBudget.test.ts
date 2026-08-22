import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACP_SESSION_CONTEXT_BUDGET,
  resolveAcpSessionContextBudget,
} from './sessionBudget';

describe('resolveAcpSessionContextBudget', () => {
  it('uses bounded production defaults', () => {
    expect(resolveAcpSessionContextBudget({})).toEqual(DEFAULT_ACP_SESSION_CONTEXT_BUDGET);
  });

  it('accepts positive integer overrides and rejects invalid values', () => {
    expect(resolveAcpSessionContextBudget({
      ACP_SESSION_MAX_CUMULATIVE_INPUT_TOKENS: '64000',
      ACP_SESSION_MAX_TERMINATED_INVOCATIONS: '6',
    })).toEqual({
      maxCumulativeInputTokens: 64_000,
      maxTerminatedInvocations: 6,
    });
    expect(resolveAcpSessionContextBudget({
      ACP_SESSION_MAX_CUMULATIVE_INPUT_TOKENS: '0',
      ACP_SESSION_MAX_TERMINATED_INVOCATIONS: 'many',
    })).toEqual(DEFAULT_ACP_SESSION_CONTEXT_BUDGET);
  });
});
