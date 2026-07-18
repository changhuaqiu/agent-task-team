import { describe, expect, it } from 'vitest';
import { evaluateTaskStatusEvidenceGate, hasCurrentVerifiedMerge } from '@/server/task-flow/task-gate-evidence';

describe('task status evidence gates', () => {
  it('blocks review entry without implementation evidence', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'in_review',
      evidence: { installResult: 'pnpm install passed' },
      pullRequestRequired: true,
      verifiedPullRequest: false,
    });

    expect(decision).toMatchObject({
      allowed: false,
      required: true,
      gateName: 'implementation_evidence',
      reasonCode: 'task_graph.gate_evidence_required',
      missingFields: ['buildResult', 'testResult', 'impactEvidence', 'pullRequestReceipt'],
    });
  });

  it('allows review entry with implementation evidence', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'in_review',
      evidence: {
        installResult: 'pnpm install passed',
        buildResult: 'pnpm build passed',
        testResult: 'pnpm test passed',
        impactEvidence: 'repository query: task status gate',
      },
      pullRequestRequired: true,
      verifiedPullRequest: true,
    });

    expect(decision).toMatchObject({
      allowed: true,
      required: true,
      gateName: 'implementation_evidence',
    });
  });

  it('blocks a Git-backed task from entering review without a verified PR receipt', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'in_review',
      evidence: {
        installResult: 'passed', buildResult: 'passed', testResult: 'passed', impactEvidence: 'checked',
      },
      pullRequestRequired: true,
      verifiedPullRequest: false,
    });
    expect(decision).toMatchObject({ allowed: false, missingFields: ['pullRequestReceipt'] });
  });

  it('blocks done without delivery evidence', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'done',
      evidence: {
        mergedToMain: true,
        mainBuildResult: 'pnpm build passed',
      },
    });

    expect(decision).toMatchObject({
      allowed: false,
      required: true,
      gateName: 'delivery_evidence',
      missingFields: ['mainInstallResult', 'mainTestResult', 'mainImpactReviewResult'],
    });
  });

  it('blocks a Git-backed done transition without a verified merge receipt', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'done',
      pullRequestRequired: true,
      verifiedMerge: false,
      evidence: {
        mergedToMain: true, mainInstallResult: 'passed', mainBuildResult: 'passed',
        mainTestResult: 'passed', mainImpactReviewResult: 'passed',
      },
    });

    expect(decision).toMatchObject({ allowed: false, missingFields: ['mergeReceipt'] });
  });

  it('accepts only a merge receipt linked to the latest PR action and exact head', () => {
    const pr1 = { id: 'pr-1', type: 'task.pull_request_submitted' as const, payload: JSON.stringify({ receipt: { headSha: 'a' } }) };
    const merge1 = { id: 'merge-1', type: 'task.pull_request_merged' as const, payload: JSON.stringify({ pullRequestActionId: 'pr-1', receipt: { headSha: 'a', mergeSha: 'm1' } }) };
    expect(hasCurrentVerifiedMerge([pr1, merge1])).toBe(true);

    const pr2 = { id: 'pr-2', type: 'task.pull_request_submitted' as const, payload: JSON.stringify({ receipt: { headSha: 'b' } }) };
    expect(hasCurrentVerifiedMerge([pr1, merge1, pr2])).toBe(false);
  });
});

