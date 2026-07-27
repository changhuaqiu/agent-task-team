import { describe, expect, it } from 'vitest';
import type { ProofEventRow } from '../repositories/proof-log-repo';
import type { DeliveryRunSnapshot, GoalContract } from './types';
import {
  validateAcceptanceVerificationReceipt,
  verificationReceiptFromProof,
} from './verification-receipt';

const contract: GoalContract = {
  idempotencyKey: 'verification-receipt-delivery',
  goal: '完成 Web UI 交付',
  acceptanceCriteria: ['用户可以创建项目', '调试面板显示 Context Snapshot'],
  scope: { conversationId: 'conv-1' },
  authorization: {
    allowCodeChanges: true,
    allowPush: false,
    allowPullRequest: false,
    allowAutoMerge: false,
  },
  recoveryPolicy: {
    maxAttemptsPerAction: 3,
    maxRepairCycles: 2,
    stallTimeoutMs: 60_000,
  },
  deliveryPolicy: {
    requireReview: true,
    requireWebE2E: true,
    requireMerge: false,
  },
};

function snapshot(): DeliveryRunSnapshot {
  return {
    run: {
      id: 'run-1',
      conversation_id: 'conv-1',
      root_task_id: 'task-1',
      status: 'active',
      current_stage: 'verifying',
      goal_contract_json: JSON.stringify(contract),
      repair_cycle: 0,
      revision: 0,
      escalation_code: null,
      escalation_detail: null,
      delivery_bundle_json: null,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
      completed_at: null,
    },
    contract,
    actions: [],
    attempts: [],
    receipts: [],
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    deliveryRunId: 'run-1',
    status: 'passed',
    method: 'web_ui_e2e',
    verifierAgentId: 'qa',
    tool: 'playwright',
    reportRef: 'playwright-report/index.html',
    specRefs: ['e2e/group-chat-task-flow.spec.ts'],
    acceptanceResults: contract.acceptanceCriteria.map(criterion => ({
      criterion,
      status: 'passed',
      evidenceRefs: [`trace:${criterion}`],
    })),
    ...overrides,
  };
}

describe('Acceptance Verification Receipt', () => {
  it('accepts a current-run Playwright receipt with criterion-specific evidence', () => {
    expect(validateAcceptanceVerificationReceipt(receipt(), snapshot())).toMatchObject({
      present: true,
      valid: true,
      payload: {
        status: 'passed',
        method: 'web_ui_e2e',
        tool: 'playwright',
      },
      errors: [],
    });
  });

  it('rejects an old run, missing criterion, or non-browser method', () => {
    const result = validateAcceptanceVerificationReceipt(receipt({
      deliveryRunId: 'run-old',
      method: 'automated_test',
      tool: 'vitest',
      acceptanceResults: [receipt().acceptanceResults[0]],
    }), snapshot());

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'delivery_run_mismatch',
      'acceptance_criteria_mismatch',
      'web_e2e_method_required',
      'web_e2e_tool_required',
    ]));
  });

  it('only reads verificationReceipt from a current delivery-evidence proof', () => {
    const proof: ProofEventRow = {
      id: 'proof-1',
      event_type: 'task_graph.gate_evidence.accepted',
      conversation_id: 'conv-1',
      task_id: 'task-1',
      chain_id: null,
      pass_id: null,
      envelope_id: null,
      node_id: null,
      agent_id: 'qa',
      actor_id: 'qa',
      reason_code: null,
      metadata: JSON.stringify({
        gateName: 'delivery_evidence',
        evidence: { verificationReceipt: receipt() },
      }),
      created_at: '2026-07-19T00:01:00.000Z',
    };

    expect(verificationReceiptFromProof(proof, snapshot()).valid).toBe(true);
    expect(verificationReceiptFromProof(proof, snapshot(), {
      authorizedVerifierIds: ['qa'],
      validateLocalArtifacts: false,
    }).valid).toBe(true);
    expect(verificationReceiptFromProof(proof, snapshot(), {
      authorizedVerifierIds: ['someone-else'],
      validateLocalArtifacts: false,
    }).errors).toContain('verifier_not_authorized');
    expect(verificationReceiptFromProof({
      ...proof,
      created_at: '2026-07-18T23:59:00.000Z',
    }, snapshot()).present).toBe(false);
  });
});
