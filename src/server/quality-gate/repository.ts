import { getDb } from '../db';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { generateSortableId } from '../repositories/sortable-id';
import type {
  QualityGateDecision,
  QualityGateDecisionRow,
  QualityGateActor,
  QualityGateEvidenceRow,
  QualityGateKind,
  QualityGateRow,
  QualityGateSnapshot,
  QualityGateStatus,
  QualityGateTargetType,
} from './types';

const TERMINAL_GATE_STATUSES = new Set<QualityGateStatus>([
  'passed',
  'changes_requested',
  'rejected',
  'cancelled',
]);

export class QualityGateInvariantError extends Error {
  readonly reasonCode = 'quality_gate_invariant_failed';

  constructor(readonly detail: string) {
    super(detail);
  }
}

export class StaleQualityGateRevisionError extends Error {
  readonly reasonCode = 'stale_quality_gate_revision';

  constructor(readonly gateId: string, readonly expected: number, readonly actual: number) {
    super(`Stale quality gate revision for ${gateId}: expected ${expected}, actual ${actual}`);
  }
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new QualityGateInvariantError(`${field} is required`);
  return normalized;
}

export class QualityGateRepository {
  request(input: {
    conversationId: string;
    kind: QualityGateKind;
    targetType: QualityGateTargetType;
    targetId: string;
    artifactRevision: string;
    criteria: unknown;
    policy?: unknown;
    actor: QualityGateActor;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateSnapshot {
    const targetId = requireText(input.targetId, 'targetId');
    const artifactRevision = requireText(input.artifactRevision, 'artifactRevision');
    const requestedBy = requireText(input.actor.id, 'actor.id');
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT * FROM quality_gate
        WHERE kind=? AND target_type=? AND target_id=? AND artifact_revision=?
      `).get(
        input.kind,
        input.targetType,
        targetId,
        artifactRevision,
      ) as QualityGateRow | undefined;
      if (existing) return this.getSnapshot(existing.id)!;

      const id = generateSortableId('gate');
      db.prepare(`
        INSERT INTO quality_gate (
          id,conversation_id,kind,target_type,target_id,artifact_revision,status,
          criteria_json,policy_json,requested_by_type,requested_by,revision,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,'requested',?,?,?,?,?,?,?)
      `).run(
        id,
        input.conversationId,
        input.kind,
        input.targetType,
        targetId,
        artifactRevision,
        JSON.stringify(input.criteria ?? {}),
        JSON.stringify(input.policy ?? {}),
        input.actor.type,
        requestedBy,
        0,
        timestamp,
        timestamp,
      );
      new DomainEventPublisher(db).publish({
        type: 'gate.requested',
        projectId: input.conversationId,
        aggregate: { type: 'quality_gate', id, version: 0 },
        subject: { type: input.targetType, id: targetId },
        actor: input.actor,
        projectAgentId: input.actor.type === 'agent' ? input.actor.id : undefined,
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: timestamp,
        payload: {
          kind: input.kind,
          targetType: input.targetType,
          targetId,
          artifactRevision,
          status: 'requested',
        },
      });
      return this.getSnapshot(id)!;
    }).immediate();
  }

  get(gateId: string): QualityGateRow | undefined {
    return getDb().prepare('SELECT * FROM quality_gate WHERE id=?')
      .get(gateId) as QualityGateRow | undefined;
  }

  getSnapshot(gateId: string): QualityGateSnapshot | undefined {
    const gate = this.get(gateId);
    if (!gate) return undefined;
    const evidence = getDb().prepare(
      'SELECT * FROM quality_gate_evidence WHERE gate_id=? ORDER BY created_at,id',
    ).all(gateId) as QualityGateEvidenceRow[];
    const decision = getDb().prepare('SELECT * FROM quality_gate_decision WHERE gate_id=?')
      .get(gateId) as QualityGateDecisionRow | undefined;
    return {
      gate,
      criteria: parseJson(gate.criteria_json),
      policy: parseJson(gate.policy_json),
      evidence,
      decision,
    };
  }

  find(input: {
    kind: QualityGateKind;
    targetType: QualityGateTargetType;
    targetId: string;
    artifactRevision: string;
  }): QualityGateSnapshot | undefined {
    const row = getDb().prepare(`
      SELECT * FROM quality_gate
      WHERE kind=? AND target_type=? AND target_id=? AND artifact_revision=?
    `).get(
      input.kind,
      input.targetType,
      input.targetId,
      input.artifactRevision,
    ) as QualityGateRow | undefined;
    return row ? this.getSnapshot(row.id) : undefined;
  }

  listForTarget(targetType: QualityGateTargetType, targetId: string): QualityGateRow[] {
    return getDb().prepare(`
      SELECT * FROM quality_gate
      WHERE target_type=? AND target_id=?
      ORDER BY created_at,id
    `).all(targetType, targetId) as QualityGateRow[];
  }

  submitEvidence(input: {
    gateId: string;
    evidenceType: string;
    payload: unknown;
    sourceRef?: string;
    actor: QualityGateActor;
    idempotencyKey: string;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateEvidenceRow {
    const evidenceType = requireText(input.evidenceType, 'evidenceType');
    const submittedBy = requireText(input.actor.id, 'actor.id');
    const idempotencyKey = requireText(input.idempotencyKey, 'idempotencyKey');
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const gate = this.get(input.gateId);
      if (!gate) throw new QualityGateInvariantError(`Quality gate not found: ${input.gateId}`);
      if (TERMINAL_GATE_STATUSES.has(gate.status)) {
        throw new QualityGateInvariantError(`Quality gate ${input.gateId} is terminal`);
      }
      const existing = db.prepare(`
        SELECT * FROM quality_gate_evidence WHERE gate_id=? AND idempotency_key=?
      `).get(input.gateId, idempotencyKey) as QualityGateEvidenceRow | undefined;
      if (existing) return existing;

      const id = generateSortableId('gate-evidence');
      db.prepare(`
        INSERT INTO quality_gate_evidence (
          id,gate_id,evidence_type,payload_json,source_ref,submitted_by_type,submitted_by,
          idempotency_key,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
      `).run(
        id,
        input.gateId,
        evidenceType,
        JSON.stringify(input.payload ?? {}),
        input.sourceRef ?? null,
        input.actor.type,
        submittedBy,
        idempotencyKey,
        timestamp,
      );
      new DomainEventPublisher(db).publish({
        type: 'gate.evidence_submitted',
        projectId: gate.conversation_id,
        aggregate: { type: 'quality_gate', id: gate.id, version: gate.revision },
        subject: { type: gate.target_type, id: gate.target_id },
        actor: input.actor,
        projectAgentId: input.actor.type === 'agent' ? input.actor.id : undefined,
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: timestamp,
        dedupeKey: `gate:${gate.id}:evidence:${idempotencyKey}`,
        payload: { gateId: gate.id, evidenceId: id, evidenceType },
      });
      return db.prepare('SELECT * FROM quality_gate_evidence WHERE id=?')
        .get(id) as QualityGateEvidenceRow;
    }).immediate();
  }

  beginEvaluation(input: {
    gateId: string;
    evaluator: QualityGateActor;
    expectedRevision: number;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateSnapshot {
    return this.transitionOpen({
      gateId: input.gateId,
      evaluator: { ...input.evaluator, id: requireText(input.evaluator.id, 'evaluator.id') },
      expectedRevision: input.expectedRevision,
      to: 'evaluating',
      correlationId: input.correlationId,
      causationId: input.causationId,
      now: input.now,
    });
  }

  decide(input: {
    gateId: string;
    decision: Exclude<QualityGateDecision, 'cancelled'>;
    evaluator: QualityGateActor;
    evidenceIds: string[];
    reason?: string;
    expectedRevision: number;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateSnapshot {
    const evaluatorId = requireText(input.evaluator.id, 'evaluator.id');
    const evidenceIds = [...new Set(input.evidenceIds)];
    if (evidenceIds.length === 0) {
      throw new QualityGateInvariantError('A gate decision requires evidence');
    }
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const gate = this.get(input.gateId);
      if (!gate) throw new QualityGateInvariantError(`Quality gate not found: ${input.gateId}`);
      if (gate.revision !== input.expectedRevision) {
        throw new StaleQualityGateRevisionError(gate.id, input.expectedRevision, gate.revision);
      }
      if (gate.status !== 'evaluating') {
        throw new QualityGateInvariantError(`Gate decision requires evaluating, got ${gate.status}`);
      }
      const ownedEvidence = db.prepare(`
        SELECT id FROM quality_gate_evidence
        WHERE gate_id=? AND id IN (${evidenceIds.map(() => '?').join(',')})
      `).all(gate.id, ...evidenceIds) as Array<{ id: string }>;
      if (ownedEvidence.length !== evidenceIds.length) {
        throw new QualityGateInvariantError('Decision references evidence from another gate');
      }
      const result = db.prepare(`
        UPDATE quality_gate
        SET status=?,evaluator_type=?,evaluator_id=?,decision_reason=?,revision=revision+1,
            updated_at=?,decided_at=?
        WHERE id=? AND revision=? AND status='evaluating'
      `).run(
        input.decision,
        input.evaluator.type,
        evaluatorId,
        input.reason ?? null,
        timestamp,
        timestamp,
        gate.id,
        input.expectedRevision,
      );
      if (result.changes !== 1) {
        const current = this.get(gate.id)!;
        throw new StaleQualityGateRevisionError(gate.id, input.expectedRevision, current.revision);
      }
      const decisionId = generateSortableId('gate-decision');
      db.prepare(`
        INSERT INTO quality_gate_decision (
          id,gate_id,decision,evaluator_type,evaluator_id,reason,evidence_ids_json,created_at
        ) VALUES (?,?,?,?,?,?,?,?)
      `).run(
        decisionId,
        gate.id,
        input.decision,
        input.evaluator.type,
        evaluatorId,
        input.reason ?? null,
        JSON.stringify(evidenceIds),
        timestamp,
      );
      const current = this.get(gate.id)!;
      new DomainEventPublisher(db).publish({
        type: `gate.${input.decision}` as
          | 'gate.passed'
          | 'gate.changes_requested'
          | 'gate.rejected',
        projectId: current.conversation_id,
        aggregate: { type: 'quality_gate', id: current.id, version: current.revision },
        subject: { type: current.target_type, id: current.target_id },
        actor: input.evaluator,
        projectAgentId: input.evaluator.type === 'agent' ? input.evaluator.id : undefined,
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: timestamp,
        payload: {
          gateId: current.id,
          kind: current.kind,
          targetId: current.target_id,
          artifactRevision: current.artifact_revision,
          evaluatorId,
          evidenceIds,
          ...(input.reason ? { reason: input.reason } : {}),
        },
      });
      return this.getSnapshot(gate.id)!;
    }).immediate();
  }

  cancel(input: {
    gateId: string;
    actor: QualityGateActor;
    reason: string;
    expectedRevision: number;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateSnapshot {
    const reason = requireText(input.reason, 'reason');
    const snapshot = this.transitionOpen({
      gateId: input.gateId,
      evaluator: { ...input.actor, id: requireText(input.actor.id, 'actor.id') },
      expectedRevision: input.expectedRevision,
      to: 'cancelled',
      reason,
      correlationId: input.correlationId,
      causationId: input.causationId,
      now: input.now,
    });
    return snapshot;
  }

  private transitionOpen(input: {
    gateId: string;
    evaluator: QualityGateActor;
    expectedRevision: number;
    to: 'evaluating' | 'cancelled';
    reason?: string;
    correlationId?: string;
    causationId?: string;
    now?: Date;
  }): QualityGateSnapshot {
    const timestamp = (input.now ?? new Date()).toISOString();
    const db = getDb();
    return db.transaction(() => {
      const gate = this.get(input.gateId);
      if (!gate) throw new QualityGateInvariantError(`Quality gate not found: ${input.gateId}`);
      if (gate.revision !== input.expectedRevision) {
        throw new StaleQualityGateRevisionError(gate.id, input.expectedRevision, gate.revision);
      }
      const allowed = input.to === 'evaluating'
        ? gate.status === 'requested'
        : gate.status === 'requested' || gate.status === 'evaluating';
      if (!allowed) {
        throw new QualityGateInvariantError(`Illegal gate transition: ${gate.status} -> ${input.to}`);
      }
      const result = db.prepare(`
        UPDATE quality_gate
        SET status=?,evaluator_type=?,evaluator_id=?,decision_reason=?,revision=revision+1,
            updated_at=?,decided_at=?
        WHERE id=? AND revision=? AND status=?
      `).run(
        input.to,
        input.evaluator.type,
        input.evaluator.id,
        input.reason ?? null,
        timestamp,
        input.to === 'cancelled' ? timestamp : null,
        gate.id,
        input.expectedRevision,
        gate.status,
      );
      if (result.changes !== 1) {
        const current = this.get(gate.id)!;
        throw new StaleQualityGateRevisionError(gate.id, input.expectedRevision, current.revision);
      }
      const current = this.get(gate.id)!;
      if (input.to === 'cancelled') {
        db.prepare(`
          INSERT INTO quality_gate_decision (
            id,gate_id,decision,evaluator_type,evaluator_id,reason,evidence_ids_json,created_at
          ) VALUES (?,?,?,?,?,?,?,?)
        `).run(
          generateSortableId('gate-decision'),
          current.id,
          'cancelled',
          input.evaluator.type,
          input.evaluator.id,
          input.reason ?? null,
          '[]',
          timestamp,
        );
      }
      new DomainEventPublisher(db).publish({
        type: input.to === 'evaluating' ? 'gate.evaluating' : 'gate.cancelled',
        projectId: current.conversation_id,
        aggregate: { type: 'quality_gate', id: current.id, version: current.revision },
        subject: { type: current.target_type, id: current.target_id },
        actor: input.evaluator,
        projectAgentId: input.evaluator.type === 'agent' ? input.evaluator.id : undefined,
        correlationId: input.correlationId,
        causationId: input.causationId,
        occurredAt: timestamp,
        payload: input.to === 'evaluating'
          ? { gateId: current.id, evaluatorId: input.evaluator.id }
          : { gateId: current.id, actorId: input.evaluator.id, reason: input.reason! },
      });
      return this.getSnapshot(gate.id)!;
    }).immediate();
  }
}

export const qualityGateRepo = new QualityGateRepository();
