import type Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { createTestDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import { QualityGateRepository } from './repository';
import { GateOutcomeProcessManager } from './outcome-process-manager';

describe('GateOutcomeProcessManager', () => {
  let db: Database.Database;
  let deliveries: AutonomousDeliveryRepository;
  let contracts: WorkContractRepository;
  let gates: QualityGateRepository;
  let runId: string;
  let projectDir: string;
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'ath-gate-outcome-'));
    mkdirSync(join(projectDir, 'evidence'));
    writeFileSync(join(projectDir, 'evidence', 'report.txt'), 'report');
    writeFileSync(join(projectDir, 'evidence', 'spec.md'), 'spec');
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    deliveries = new AutonomousDeliveryRepository();
    contracts = new WorkContractRepository();
    gates = new QualityGateRepository();
    runId = deliveries.createRun({
      idempotencyKey: 'quality-gate-outcome-delivery',
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1', projectPath: projectDir },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: false,
        requireWebE2E: false,
        requireMerge: false,
      },
    }, now).run.id;
  });

  afterEach(() => {
    resetDb();
    db.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  it('turns an accepted verification outcome into one authoritative Gate decision', async () => {
    const requested = gates.request({
      conversationId: 'project-1',
      kind: 'acceptance_verification',
      targetType: 'delivery_run',
      targetId: runId,
      artifactRevision: 'revision-1',
      criteria: { acceptanceCriteria: ['Works'] },
      actor: { type: 'system', id: 'delivery-control-process-manager' },
      now,
    });
    const contract = contracts.issue({
      workId: `delivery:${runId}:agent:qa:purpose:verify`,
      attemptId: 'inv-verify',
      projectId: 'project-1',
      deliveryRunId: runId,
      agentId: 'qa',
      goal: 'Verify delivery',
      acceptanceCriteria: ['Works'],
      role: { id: 'qa' },
      permissions: {},
      authoritativeRefs: [`delivery_run:${runId}`, `quality_gate:${requested.gate.id}`],
      authoritativeRevisions: { deliveryRun: 0, qualityGate: 0 },
      contextSnapshotRef: 'context:verify',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'correlation-1',
      causationId: requested.gate.id,
      now,
    });
    const outcomePayload = {
      gateId: requested.gate.id,
      decision: 'passed',
      evidenceType: 'acceptance_verification',
      evidence: { report: 'test:report' },
      receipt: {
        schemaVersion: 1,
        deliveryRunId: runId,
        status: 'passed',
        method: 'automated_test',
        verifierAgentId: 'qa',
        tool: 'vitest',
        reportRef: 'evidence/report.txt',
        specRefs: ['evidence/spec.md'],
        acceptanceResults: [{
          criterion: 'Works',
          status: 'passed',
          evidenceRefs: ['test:report'],
        }],
      },
    };
    const admitted = contracts.admitOutcome({
      outcomeId: 'outcome-verify',
      idempotencyKey: 'verify:decision',
      contractId: contract.contractId,
      outcomeType: 'record_gate_decision',
      payload: outcomePayload,
      evidenceRefs: ['test:report'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    }, now);
    expect(admitted.status).toBe('accepted');
    const event = new PlatformEventLog({ db })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const foreignDb = createTestDb();
    setTestDb(foreignDb);
    try {
      const manager = new GateOutcomeProcessManager({ db });
      await manager.handle(event, { signal: new AbortController().signal });
      await manager.handle(event, { signal: new AbortController().signal });
      expect(foreignDb.prepare('SELECT COUNT(*) AS count FROM quality_gate').get())
        .toEqual({ count: 0 });
    } finally {
      setTestDb(db);
      foreignDb.close();
    }

    expect(gates.getSnapshot(requested.gate.id)).toMatchObject({
      gate: {
        status: 'passed',
        evaluator_type: 'agent',
        evaluator_id: 'qa',
      },
      evidence: [{ idempotency_key: 'agent-outcome:outcome-verify' }],
      decision: { decision: 'passed', evaluator_id: 'qa' },
    });
    expect(deliveries.getSnapshot(runId)?.receipts).toMatchObject([{
      kind: 'verification.acceptance',
      status: 'passed',
      external_id: requested.gate.id,
    }]);
    const receiptEvent = new PlatformEventLog({ db }).listTrace(event.correlationId)
      .find((candidate) => candidate.type === 'delivery.receipt.recorded');
    expect(receiptEvent).toMatchObject({
      correlationId: event.correlationId,
      causationId: event.eventId,
      subject: {
        type: 'delivery_receipt',
      },
    });
  });

  it('rejects invalid live verification receipts before the QualityGate seam', () => {
    const cases = [
      {
        name: 'verifier',
        error: 'gate_outcome_verifier_mismatch',
      },
      {
        name: 'decision',
        error: 'gate_outcome_verification_decision_mismatch',
      },
      {
        name: 'malformed',
        error: 'gate_outcome_verification_receipt_invalid:report_ref_missing',
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const requested = gates.request({
        conversationId: 'project-1',
        kind: 'acceptance_verification',
        targetType: 'delivery_run',
        targetId: runId,
        artifactRevision: `invalid-${index}`,
        criteria: { acceptanceCriteria: ['Works'] },
        actor: { type: 'system', id: 'delivery-control-process-manager' },
        now,
      });
      const contract = contracts.issue({
        workId: `delivery:${runId}:agent:qa:purpose:invalid-${testCase.name}`,
        attemptId: `inv-${testCase.name}`,
        projectId: 'project-1',
        deliveryRunId: runId,
        agentId: 'qa',
        goal: 'Verify delivery',
        acceptanceCriteria: ['Works'],
        role: { id: 'qa' },
        permissions: {},
        authoritativeRefs: [`delivery_run:${runId}`, `quality_gate:${requested.gate.id}`],
        authoritativeRevisions: { deliveryRun: 0, qualityGate: 0 },
        contextSnapshotRef: `context:${testCase.name}`,
        allowedOutcomeTypes: ['record_gate_decision'],
        correlationId: `correlation-${testCase.name}`,
        causationId: requested.gate.id,
        now,
      });
      const validPayload = {
        gateId: requested.gate.id,
        decision: 'passed',
        evidenceType: 'acceptance_verification',
        evidence: { report: 'evidence/report.txt' },
        receipt: {
          schemaVersion: 1,
          deliveryRunId: runId,
          status: 'passed',
          method: 'automated_test',
          verifierAgentId: 'qa',
          tool: 'vitest',
          reportRef: 'evidence/report.txt',
          specRefs: ['evidence/spec.md'],
          acceptanceResults: [{
            criterion: 'Works',
            status: 'passed',
            evidenceRefs: ['evidence/report.txt'],
          }],
        },
      };
      const invalidPayload = testCase.name === 'verifier'
        ? {
            ...validPayload,
            receipt: { ...validPayload.receipt, verifierAgentId: 'intruder' },
          }
        : testCase.name === 'decision'
          ? { ...validPayload, decision: 'rejected' }
          : {
              ...validPayload,
              receipt: { ...validPayload.receipt, reportRef: '' },
            };
      const admitted = contracts.admitOutcome({
        outcomeId: `outcome-${testCase.name}`,
        idempotencyKey: `verify:${testCase.name}`,
        contractId: contract.contractId,
        outcomeType: 'record_gate_decision',
        payload: invalidPayload,
        evidenceRefs: ['evidence/report.txt'],
        projectId: contract.projectId,
        workId: contract.workId,
        workEpoch: contract.workEpoch,
        attemptId: contract.attemptId,
        fencingToken: contract.fencingToken,
        authoritativeRevisions: contract.authoritativeRevisions,
        correlationId: contract.correlationId,
        causationId: contract.contractId,
        occurredAt: now.toISOString(),
      }, now);
      expect(admitted).toMatchObject({
        status: 'rejected',
        reasonCode: testCase.error,
      });
      expect(new PlatformEventLog({ db })
        .listStream(`work:${contract.workId}`)
        .some(candidate => (
          candidate.aggregate.id === admitted.outcome.id
          && candidate.type === 'agent.outcome.accepted'
        ))).toBe(false);
      expect(gates.getSnapshot(requested.gate.id)).toMatchObject({
        gate: { status: 'requested' },
        evidence: [],
      });
      expect(gates.getSnapshot(requested.gate.id)?.decision).toBeUndefined();
      expect(deliveries.getSnapshot(runId)?.receipts).toEqual([]);
    }
  });

  it('rolls back Gate evidence and decision when the Delivery receipt conflicts', async () => {
    const requested = gates.request({
      conversationId: 'project-1',
      kind: 'acceptance_verification',
      targetType: 'delivery_run',
      targetId: runId,
      artifactRevision: 'revision-1',
      criteria: { acceptanceCriteria: ['Works'] },
      actor: { type: 'system', id: 'delivery-control-process-manager' },
      now,
    });
    const contract = contracts.issue({
      workId: `delivery:${runId}:agent:qa:purpose:verify`,
      attemptId: 'inv-verify-conflict',
      projectId: 'project-1',
      deliveryRunId: runId,
      agentId: 'qa',
      goal: 'Verify delivery',
      acceptanceCriteria: ['Works'],
      role: { id: 'qa' },
      permissions: {},
      authoritativeRefs: [`delivery_run:${runId}`, `quality_gate:${requested.gate.id}`],
      authoritativeRevisions: { deliveryRun: 0, qualityGate: 0 },
      contextSnapshotRef: 'context:verify',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'correlation-conflict',
      causationId: requested.gate.id,
      now,
    });
    const admitted = contracts.admitOutcome({
      outcomeId: 'outcome-verify-conflict',
      idempotencyKey: 'verify:decision:conflict',
      contractId: contract.contractId,
      outcomeType: 'record_gate_decision',
      payload: {
        gateId: requested.gate.id,
        decision: 'passed',
        evidenceType: 'acceptance_verification',
        evidence: { report: 'test:report' },
        receipt: {
          schemaVersion: 1,
          deliveryRunId: runId,
          status: 'passed',
          method: 'automated_test',
          verifierAgentId: 'qa',
          tool: 'vitest',
          reportRef: 'evidence/report.txt',
          specRefs: ['evidence/spec.md'],
          acceptanceResults: [{
            criterion: 'Works',
            status: 'passed',
            evidenceRefs: ['test:report'],
          }],
        },
      },
      evidenceRefs: ['test:report'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: now.toISOString(),
    }, now);
    const event = new PlatformEventLog({ db })
      .listStream(`work:${contract.workId}`)
      .find((candidate) =>
        candidate.type === 'agent.outcome.accepted'
        && candidate.aggregate.id === admitted.outcome.id
      )!;
    deliveries.recordReceipt({
      runId,
      receipt: {
        kind: 'verification.acceptance',
        status: 'failed',
        externalId: requested.gate.id,
        payload: { conflicting: true },
        idempotencyKey: `${runId}:acceptance_verification:outcome:${admitted.outcome.id}`,
      },
      now,
    });

    const manager = new GateOutcomeProcessManager({ db, gates });
    expect(() => manager.handle(event, { signal: new AbortController().signal }))
      .toThrow('Delivery receipt idempotency key is already bound');

    expect(gates.getSnapshot(requested.gate.id)).toMatchObject({
      gate: { status: 'requested', revision: 0 },
      evidence: [],
      decision: undefined,
    });
  });
});
