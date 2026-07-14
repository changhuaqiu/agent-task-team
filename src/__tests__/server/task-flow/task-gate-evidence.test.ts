import { describe, expect, it } from 'vitest';
import { evaluateTaskStatusEvidenceGate } from '@/server/task-flow/task-gate-evidence';

describe('task status evidence gates', () => {
  it('blocks review entry without implementation evidence', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'in_review',
      evidence: { installResult: 'pnpm install passed' },
    });

    expect(decision).toMatchObject({
      allowed: false,
      required: true,
      gateName: 'implementation_evidence',
      reasonCode: 'task_graph.gate_evidence_required',
      missingFields: ['buildResult', 'impactEvidence'],
    });
  });

  it('allows review entry with implementation evidence', () => {
    const decision = evaluateTaskStatusEvidenceGate({
      nextStatus: 'in_review',
      evidence: {
        installResult: 'pnpm install passed',
        buildResult: 'pnpm build passed',
        impactEvidence: 'repository query: task status gate',
      },
    });

    expect(decision).toMatchObject({
      allowed: true,
      required: true,
      gateName: 'implementation_evidence',
    });
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
});

