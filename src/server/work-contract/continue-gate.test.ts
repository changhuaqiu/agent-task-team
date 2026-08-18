import { describe, expect, it } from 'vitest';
import { ContinueGateLite } from './continue-gate';

const validCheckpoint = {
  schemaVersion: 1,
  reason: 'multi_step',
  summary: 'Repository mapping is complete.',
  nextAction: 'Implement the scheduler change.',
  completedSteps: ['Mapped the current lifecycle.'],
  remainingSteps: ['Implement the change.', 'Run focused tests.'],
};

describe('ContinueGateLite', () => {
  const gate = new ContinueGateLite();

  it('normalizes a versioned continuation checkpoint', () => {
    expect(gate.admit({
      ...validCheckpoint,
      summary: '  Repository mapping is complete.  ',
    })).toEqual({
      accepted: true,
      checkpoint: validCheckpoint,
    });
  });

  it.each([
    [{ ...validCheckpoint, schemaVersion: 2 }, 'continuation_schema_version_invalid'],
    [{ ...validCheckpoint, summary: '' }, 'continuation_summary_required'],
    [{ ...validCheckpoint, nextAction: '' }, 'continuation_next_action_required'],
    [{ ...validCheckpoint, remainingSteps: [] }, 'continuation_remaining_steps_required'],
  ])('rejects an unusable checkpoint %#', (payload, reasonCode) => {
    expect(gate.admit(payload)).toEqual({ accepted: false, reasonCode });
  });

  it('continues within its own budget and escalates after the boundary', () => {
    expect(gate.decide({ requested: true, continuationsUsed: 2, maxContinuations: 2 }))
      .toEqual({ disposition: 'continue', reasonCode: 'agent_requested_continuation' });
    expect(gate.decide({ requested: true, continuationsUsed: 3, maxContinuations: 2 }))
      .toEqual({ disposition: 'escalate', reasonCode: 'continuation_budget_exhausted' });
  });
});
