import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeliveryRunSnapshot, GoalContract } from './types';
import {
  validateAcceptanceVerificationReceipt,
} from './verification-receipt';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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
  const projectDir = mkdtempSync(join(tmpdir(), 'ath-verification-receipt-default-'));
  tempDirs.push(projectDir);
  mkdirSync(join(projectDir, 'playwright-report'));
  mkdirSync(join(projectDir, 'e2e'));
  writeFileSync(join(projectDir, 'playwright-report', 'index.html'), 'report');
  writeFileSync(join(projectDir, 'e2e', 'group-chat-task-flow.spec.ts'), 'spec');
  const snapshotContract: GoalContract = {
    ...contract,
    scope: { ...contract.scope, projectPath: projectDir },
  };
  return {
    run: {
      id: 'run-1',
      conversation_id: 'conv-1',
      root_task_id: 'task-1',
      status: 'active',
      current_stage: 'verifying',
      goal_contract_json: JSON.stringify(snapshotContract),
      repair_cycle: 0,
      revision: 0,
      escalation_code: null,
      escalation_detail: null,
      delivery_bundle_json: null,
      created_at: '2026-07-19T00:00:00.000Z',
      updated_at: '2026-07-19T00:00:00.000Z',
      completed_at: null,
    },
    contract: snapshotContract,
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

  it('normalizes common agent receipt dialects without relaxing evidence requirements', () => {
    const result = validateAcceptanceVerificationReceipt(receipt({
      tool: 'Playwright browser_run_code_unsafe real page navigation',
      evidenceRefs: ['qa/reports/verification.md'],
      acceptanceResults: contract.acceptanceCriteria.map((criterion, index) => ({
        criterion: `AC${index + 1} ${criterion}`,
        result: 'PASS',
      })),
    }), snapshot());

    expect(result).toMatchObject({
      valid: true,
      payload: {
        status: 'passed',
        tool: 'Playwright browser_run_code_unsafe real page navigation',
        acceptanceResults: contract.acceptanceCriteria.map(criterion => ({
          criterion,
          status: 'passed',
          evidenceRefs: ['qa/reports/verification.md'],
        })),
      },
      errors: [],
    });
  });

  it('validates project-local report/spec files and rejects junction escapes', () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'ath-verification-receipt-'));
    tempDirs.push(parentDir);
    const projectDir = join(parentDir, 'project');
    const outsideDir = join(parentDir, 'outside');
    mkdirSync(projectDir);
    mkdirSync(outsideDir);
    mkdirSync(join(projectDir, 'reports'));
    mkdirSync(join(projectDir, 'e2e'));
    writeFileSync(join(projectDir, 'reports', 'acceptance.html'), 'report');
    writeFileSync(join(projectDir, 'e2e', 'acceptance.spec.ts'), 'spec');
    writeFileSync(join(outsideDir, 'report.html'), 'outside');
    symlinkSync(outsideDir, join(projectDir, 'linked'), 'junction');
    const localSnapshot = snapshot();
    localSnapshot.contract = {
      ...contract,
      scope: { ...contract.scope, projectPath: projectDir },
    };

    expect(validateAcceptanceVerificationReceipt(receipt({
      reportRef: 'reports/acceptance.html',
      specRefs: ['e2e/acceptance.spec.ts'],
    }), localSnapshot).valid).toBe(true);
    expect(validateAcceptanceVerificationReceipt(receipt({
      reportRef: 'linked/report.html',
      specRefs: ['e2e/acceptance.spec.ts'],
    }), localSnapshot).errors).toContain('report_ref_outside_project');
    expect(validateAcceptanceVerificationReceipt(receipt({
      reportRef: 'reports/missing.html',
      specRefs: ['e2e/acceptance.spec.ts'],
    }), localSnapshot).errors).toContain('report_ref_missing');
    expect(validateAcceptanceVerificationReceipt(receipt({
      reportRef: 'https://evidence.example.test/report',
      specRefs: ['e2e/acceptance.spec.ts'],
    }), localSnapshot).errors).toContain('report_ref_remote_untrusted');
  });
});
