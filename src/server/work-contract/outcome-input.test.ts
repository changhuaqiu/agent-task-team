import { describe, expect, it } from 'vitest';
import { InvalidAgentOutcomeInputError, parseAgentOutcomeInput } from './outcome-input';

const baseInput = {
  outcomeId: 'outcome-1',
  idempotencyKey: 'outcome-key-1',
  contractId: 'contract-1',
  outcomeType: 'record_gate_decision',
  payload: {
    gateId: 'gate-1',
    decision: 'rejected',
    evidenceType: 'code_review',
    evidence: { summary: 'blocking issue' },
  },
  evidenceRefs: ['report:test'],
  projectId: 'project-1',
  workId: 'work-1',
  workEpoch: 1,
  attemptId: 'attempt-1',
  fencingToken: 'fence-1',
  authoritativeRevisions: { task: 1 },
  correlationId: 'correlation-1',
  causationId: 'causation-1',
  occurredAt: '2026-08-17T00:00:00.000Z',
};

describe('parseAgentOutcomeInput', () => {
  it('accepts the canonical Quality Gate decision vocabulary', () => {
    expect(parseAgentOutcomeInput(baseInput)).toMatchObject({
      outcomeType: 'record_gate_decision',
      payload: expect.objectContaining({ decision: 'rejected' }),
    });
  });

  it('rejects informal gate verdict aliases before admission', () => {
    expect(() => parseAgentOutcomeInput({
      ...baseInput,
      payload: { ...baseInput.payload, decision: 'reject' },
    })).toThrowError(InvalidAgentOutcomeInputError);
  });

  it('rejects a Gate decision without explicit evidence before admission', () => {
    const payload = {
      gateId: baseInput.payload.gateId,
      decision: baseInput.payload.decision,
      evidenceType: baseInput.payload.evidenceType,
    };
    expect(() => parseAgentOutcomeInput({ ...baseInput, payload }))
      .toThrowError(InvalidAgentOutcomeInputError);
  });
});
