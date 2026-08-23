import { describe, expect, it } from 'vitest';
import { AcpRuntimeDriver } from './acp-runtime-driver';

describe('AcpRuntimeDriver', () => {
  it('owns catalog selection, turn options and runtime preparation', () => {
    const driver = new AcpRuntimeDriver();
    const turn = driver.prepareTurn({
      engine: 'claude',
      cwd: 'C:/project',
      env: { TEST_RUNTIME: '1' },
      systemPrompt: 'Follow the contract',
      resumeSessionId: 'session-1',
      timeoutMs: 30_000,
    });

    expect(turn.entry.id).toBe('claude');
    expect(turn.execOptions).toMatchObject({
      cwd: 'C:/project',
      systemPrompt: 'Follow the contract',
      resumeSessionId: 'session-1',
      timeout: 30_000,
      env: { TEST_RUNTIME: '1' },
    });
    expect(turn.backend).toBeDefined();
    expect(turn.cleanup).toBeUndefined();
  });

  it('exposes the bounded session rotation policy through the runtime boundary', () => {
    expect(new AcpRuntimeDriver().sessionContextBudget()).toEqual({
      maxCumulativeInputTokens: 120_000,
      maxTerminatedInvocations: 12,
    });
  });
});
