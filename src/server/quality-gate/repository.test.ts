import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import {
  QualityGateInvariantError,
  QualityGateRepository,
  StaleQualityGateRevisionError,
} from './repository';

describe('QualityGateRepository', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-gate', 'Quality Gate', 'active', now, now);
  });

  afterEach(() => resetDb());

  it('binds a decision to one artifact revision and keeps evidence immutable', () => {
    const repository = new QualityGateRepository();
    const requested = repository.request({
      conversationId: 'project-gate',
      kind: 'code_review',
      targetType: 'task',
      targetId: 'task-1',
      artifactRevision: 'sha-1',
      criteria: { blockers: 0 },
      policy: { selfReview: false },
      actor: { type: 'agent', id: 'implementer' },
    });
    const duplicate = repository.request({
      conversationId: 'project-gate',
      kind: 'code_review',
      targetType: 'task',
      targetId: 'task-1',
      artifactRevision: 'sha-1',
      criteria: { ignoredOnDuplicate: true },
      actor: { type: 'agent', id: 'implementer' },
    });
    expect(duplicate.gate.id).toBe(requested.gate.id);

    const evidence = repository.submitEvidence({
      gateId: requested.gate.id,
      evidenceType: 'provider_review',
      payload: { decision: 'approved', headSha: 'sha-1' },
      sourceRef: 'https://example.test/review/1',
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'provider-review-1',
    });
    const duplicateEvidence = repository.submitEvidence({
      gateId: requested.gate.id,
      evidenceType: 'provider_review',
      payload: { decision: 'tampered' },
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'provider-review-1',
    });
    expect(duplicateEvidence).toEqual(evidence);

    const evaluating = repository.beginEvaluation({
      gateId: requested.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: requested.gate.revision,
    });
    const passed = repository.decide({
      gateId: requested.gate.id,
      decision: 'passed',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [evidence.id],
      expectedRevision: evaluating.gate.revision,
    });
    expect(passed.gate).toMatchObject({
      status: 'passed',
      artifact_revision: 'sha-1',
      evaluator_type: 'agent',
      evaluator_id: 'reviewer',
      revision: 2,
    });
    expect(passed.decision).toMatchObject({
      decision: 'passed',
      evidence_ids_json: JSON.stringify([evidence.id]),
    });
    expect(() => getDb().prepare(
      "UPDATE quality_gate SET status='evaluating' WHERE id=?",
    ).run(passed.gate.id)).toThrow(/quality_gate_terminal_immutable/);
    expect(() => getDb().prepare(
      "UPDATE quality_gate_evidence SET payload_json='{}' WHERE id=?",
    ).run(evidence.id)).toThrow(/quality_gate_evidence_immutable/);
    expect(() => repository.submitEvidence({
      gateId: passed.gate.id,
      evidenceType: 'late',
      payload: {},
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'late',
    })).toThrow(QualityGateInvariantError);
    expect(() => repository.beginEvaluation({
      gateId: passed.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: passed.gate.revision,
    })).toThrow(QualityGateInvariantError);

    const nextRevision = repository.request({
      conversationId: 'project-gate',
      kind: 'code_review',
      targetType: 'task',
      targetId: 'task-1',
      artifactRevision: 'sha-2',
      criteria: { blockers: 0 },
      actor: { type: 'agent', id: 'implementer' },
    });
    expect(nextRevision.gate.id).not.toBe(passed.gate.id);
    expect(nextRevision.gate.status).toBe('requested');

    const eventLog = new PlatformEventLog();
    const events = [
      ...eventLog.listStream(`quality_gate:${passed.gate.id}`),
      ...eventLog.listStream(`quality_gate:${nextRevision.gate.id}`),
    ].map((event) => event.type);
    expect(events).toEqual([
      'gate.requested',
      'gate.evidence_submitted',
      'gate.evaluating',
      'gate.passed',
      'gate.requested',
    ]);
  });

  it('rejects stale decisions and evidence belonging to another gate', () => {
    const repository = new QualityGateRepository();
    const first = repository.request({
      conversationId: 'project-gate',
      kind: 'delivery_review',
      targetType: 'delivery_run',
      targetId: 'delivery-1',
      artifactRevision: 'delivery-rev-1',
      criteria: {},
      actor: { type: 'system', id: 'supervisor' },
    });
    const second = repository.request({
      conversationId: 'project-gate',
      kind: 'acceptance_verification',
      targetType: 'delivery_run',
      targetId: 'delivery-1',
      artifactRevision: 'delivery-rev-1',
      criteria: {},
      actor: { type: 'system', id: 'supervisor' },
    });
    const foreignEvidence = repository.submitEvidence({
      gateId: second.gate.id,
      evidenceType: 'verification',
      payload: {},
      actor: { type: 'agent', id: 'qa' },
      idempotencyKey: 'verification-1',
    });
    const evaluating = repository.beginEvaluation({
      gateId: first.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: first.gate.revision,
    });

    expect(() => repository.decide({
      gateId: first.gate.id,
      decision: 'passed',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [foreignEvidence.id],
      expectedRevision: evaluating.gate.revision,
    })).toThrow(QualityGateInvariantError);
    expect(() => repository.decide({
      gateId: first.gate.id,
      decision: 'rejected',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [foreignEvidence.id],
      expectedRevision: first.gate.revision,
    })).toThrow(StaleQualityGateRevisionError);
  });

  it('persists cancellation as a terminal decision', () => {
    const repository = new QualityGateRepository();
    const requested = repository.request({
      conversationId: 'project-gate',
      kind: 'integration',
      targetType: 'delivery_run',
      targetId: 'delivery-1',
      artifactRevision: 'sha-1',
      criteria: {},
      actor: { type: 'system', id: 'supervisor' },
    });
    const cancelled = repository.cancel({
      gateId: requested.gate.id,
      actor: { type: 'user', id: 'owner' },
      reason: 'Delivery cancelled',
      expectedRevision: requested.gate.revision,
    });
    expect(cancelled.gate.status).toBe('cancelled');
    expect(cancelled.decision).toMatchObject({
      decision: 'cancelled',
      evaluator_type: 'user',
      evaluator_id: 'owner',
    });
    getDb().prepare("DELETE FROM conversation WHERE id='project-gate'").run();
    expect(repository.get(cancelled.gate.id)).toBeUndefined();
  });
});
