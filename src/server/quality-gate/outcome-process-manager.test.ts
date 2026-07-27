import type Database from 'better-sqlite3';
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
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
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
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1' },
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
    const admitted = contracts.admitOutcome({
      outcomeId: 'outcome-verify',
      idempotencyKey: 'verify:decision',
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
          reportRef: 'test:report',
          specRefs: ['spec:works'],
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
    expect(admitted.status).toBe('accepted');
    const event = new PlatformEventLog({ db })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const manager = new GateOutcomeProcessManager({ db, gates });

    await manager.handle(event, { signal: new AbortController().signal });
    await manager.handle(event, { signal: new AbortController().signal });

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
  });
});
