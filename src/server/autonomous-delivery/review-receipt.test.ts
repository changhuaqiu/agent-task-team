import { describe, expect, it } from 'vitest';
import type { ProofEventRow } from '../repositories/proof-log-repo';
import type { DeliveryRunSnapshot } from './types';
import { reviewReceiptFromProof } from './review-receipt';

const snapshot = {
  run: {
    id: 'delivery-review',
    conversation_id: 'conv-review',
    root_task_id: 'task-review',
    status: 'active',
    current_stage: 'reviewing',
    goal_contract_json: '{}',
    repair_cycle: 0,
    revision: 0,
    escalation_code: null,
    escalation_detail: null,
    delivery_bundle_json: null,
    created_at: '2026-07-19T00:00:00.000Z',
    updated_at: '2026-07-19T00:00:00.000Z',
    completed_at: null,
  },
  contract: {
    goal: 'review',
    acceptanceCriteria: ['works'],
    scope: { conversationId: 'conv-review' },
    authorization: {
      allowCodeChanges: true,
      allowPush: false,
      allowPullRequest: false,
      allowAutoMerge: false,
    },
    recoveryPolicy: { maxAttemptsPerAction: 2, maxRepairCycles: 2, stallTimeoutMs: 1_000 },
    deliveryPolicy: { requireReview: true, requireWebE2E: true, requireMerge: false },
  },
  actions: [],
  attempts: [],
  receipts: [],
} satisfies DeliveryRunSnapshot;

function proof(reviewReceipt: Record<string, unknown>, actorId = 'peach'): ProofEventRow {
  return {
    id: 'proof-review',
    event_type: 'task_graph.gate_evidence.accepted',
    conversation_id: 'conv-review',
    task_id: 'task-review',
    chain_id: null,
    pass_id: null,
    envelope_id: null,
    node_id: null,
    agent_id: actorId,
    actor_id: actorId,
    reason_code: null,
    metadata: JSON.stringify({
      gateName: 'delivery_evidence',
      evidence: { reviewReceipt },
    }),
    created_at: '2026-07-19T00:01:00.000Z',
  };
}

describe('Acceptance Review Receipt', () => {
  it('accepts a gate owner pass with evidence and no open material findings', () => {
    const result = reviewReceiptFromProof(proof({
      schemaVersion: 1,
      deliveryRunId: snapshot.run.id,
      status: 'passed',
      reviewerAgentId: 'peach',
      summary: '代码、风险与回归检查通过',
      evidenceRefs: ['review:report.md'],
      findings: [{
        severity: 'advisory',
        status: 'open',
        description: '后续可优化文案',
        evidenceRefs: ['review:report.md#copy'],
      }],
    }), snapshot, ['peach']);

    expect(result).toMatchObject({ present: true, valid: true });
  });

  it('rejects self-reported or unauthorized review passes', () => {
    const result = reviewReceiptFromProof(proof({
      schemaVersion: 1,
      deliveryRunId: snapshot.run.id,
      status: 'passed',
      reviewerAgentId: 'luigi',
      summary: 'self reviewed',
      evidenceRefs: ['self:review'],
      findings: [],
    }, 'luigi'), snapshot, ['peach']);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('reviewer_not_authorized');
  });

  it('rejects pass when an important finding remains open', () => {
    const result = reviewReceiptFromProof(proof({
      schemaVersion: 1,
      deliveryRunId: snapshot.run.id,
      status: 'passed',
      reviewerAgentId: 'peach',
      summary: '仍有风险',
      evidenceRefs: ['review:report.md'],
      findings: [{
        severity: 'important',
        status: 'open',
        description: '缺少权限校验',
        evidenceRefs: ['src/auth.ts:10'],
      }],
    }), snapshot, ['peach']);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('unresolved_material_finding');
  });
});
