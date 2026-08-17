import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import {
  AgentOutcomeIdempotencyConflictError,
  StaleWorkAuthorityError,
  WorkContractInvariantError,
  WorkContractRepository,
} from './repository';
import type { AgentOutcome, AgentOutcomeType, WorkContract } from './types';
import { invocationRepo } from '../repositories/invocation-repo';
import { taskRepo } from '../repositories/task-repo';
import { QualityGateRepository } from '../quality-gate/repository';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';

const NOW = new Date('2026-07-28T08:00:00.000Z');

function issue(
  repository: WorkContractRepository,
  input: {
    attemptId: string;
    expectedCurrentEpoch?: number;
    allowedOutcomeTypes?: AgentOutcomeType[];
  },
): WorkContract {
  return repository.issue({
    workId: 'task:task-1:agent:builder',
    attemptId: input.attemptId,
    projectId: 'project-work',
    agentId: 'builder',
    goal: 'Implement the accepted task',
    acceptanceCriteria: ['tests pass', 'evidence attached'],
    role: { name: 'builder' },
    permissions: { tools: ['shell'] },
    authoritativeRefs: ['task:task-1', 'delivery:delivery-1'],
    authoritativeRevisions: { task: 3, delivery: 7 },
    contextSnapshotRef: 'ctx-1',
    allowedOutcomeTypes: input.allowedOutcomeTypes ?? [
      'continue_work',
      'submit_task_result',
      'report_blocked',
    ],
    budget: { maxTokens: 10_000 },
    correlationId: 'trace-1',
    causationId: 'trigger-1',
    expectedCurrentEpoch: input.expectedCurrentEpoch,
    now: NOW,
  });
}

function outcome(
  contract: WorkContract,
  overrides: Partial<AgentOutcome> = {},
): AgentOutcome {
  return {
    outcomeId: `outcome-${contract.workEpoch}`,
    idempotencyKey: `outcome-key-${contract.workEpoch}`,
    contractId: contract.contractId,
    outcomeType: 'submit_task_result',
    payload: { summary: 'done' },
    evidenceRefs: ['artifact:sha-1'],
    projectId: contract.projectId,
    workId: contract.workId,
    workEpoch: contract.workEpoch,
    attemptId: contract.attemptId,
    fencingToken: contract.fencingToken,
    authoritativeRevisions: contract.authoritativeRevisions,
    correlationId: contract.correlationId,
    causationId: contract.contractId,
    occurredAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('WorkContractRepository', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-work', 'Work Contract', 'active', NOW.toISOString(), NOW.toISOString());
  });

  afterEach(() => resetDb());

  it('rotates authority epochs and fences late outcomes from the old contract', () => {
    const repository = new WorkContractRepository();
    const first = issue(repository, { attemptId: 'attempt-1', expectedCurrentEpoch: 0 });
    const second = issue(repository, { attemptId: 'attempt-2', expectedCurrentEpoch: 1 });

    expect(first).toMatchObject({ workEpoch: 1, attemptId: 'attempt-1' });
    expect(second).toMatchObject({ workEpoch: 2, attemptId: 'attempt-2' });
    expect(second.fencingToken).not.toBe(first.fencingToken);
    expect(repository.getAuthority(first.workId)).toMatchObject({
      current_epoch: 2,
      current_contract_id: second.contractId,
      status: 'active',
      revision: 1,
    });

    const stale = repository.admitOutcome(outcome(first));
    expect(stale).toMatchObject({
      status: 'rejected',
      reasonCode: 'work_authority_stale',
    });
    const accepted = repository.admitOutcome(outcome(second));
    expect(accepted).toMatchObject({ status: 'accepted' });
    expect(repository.admitOutcome(outcome(second))).toMatchObject({
      status: 'duplicate',
    });
  });

  it.each([
    {
      name: 'fencing token',
      override: { fencingToken: 'forged-token' },
      reasonCode: 'fencing_token_mismatch',
    },
    {
      name: 'authoritative revision',
      override: { authoritativeRevisions: { task: 4, delivery: 7 } },
      reasonCode: 'authoritative_revision_mismatch',
    },
    {
      name: 'correlation',
      override: { correlationId: 'other-trace' },
      reasonCode: 'correlation_mismatch',
    },
  ])('rejects a mismatched $name', ({ override, reasonCode }) => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-1' });
    const admission = repository.admitOutcome(outcome(contract, override));
    expect(admission).toMatchObject({ status: 'rejected', reasonCode });
    if (reasonCode === 'correlation_mismatch') {
      expect(new PlatformEventLog().listTrace(contract.correlationId)).toEqual([
        expect.objectContaining({
          type: 'work.contract.issued',
        }),
        expect.objectContaining({
          type: 'agent.outcome.rejected',
          correlationId: contract.correlationId,
          payload: expect.objectContaining({
            reasonCode: 'correlation_mismatch',
            submittedCorrelationId: 'other-trace',
          }),
        }),
      ]);
      expect(new PlatformEventLog().listTrace('other-trace')).toEqual([]);
    }
  });

  it('rejects a valid outcome type that the contract did not authorize', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, {
      attemptId: 'attempt-1',
      allowedOutcomeTypes: ['report_blocked'],
    });
    expect(repository.admitOutcome(outcome(contract))).toMatchObject({
      status: 'rejected',
      reasonCode: 'outcome_type_not_allowed',
    });
  });

  it('allows progress updates but admits only one terminal outcome per contract', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-terminal' });
    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-progress',
      idempotencyKey: 'outcome-progress',
      outcomeType: 'continue_work',
    }))).toMatchObject({ status: 'accepted' });
    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-terminal',
      idempotencyKey: 'outcome-terminal',
    }))).toMatchObject({ status: 'accepted' });
    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-second-terminal',
      idempotencyKey: 'outcome-second-terminal',
      payload: { summary: 'contradictory' },
    }))).toMatchObject({
      status: 'rejected',
      reasonCode: 'terminal_outcome_already_accepted',
    });
  });

  it('rejects incomplete or mismatched Gate outcomes without consuming the terminal outcome slot', () => {
    const reviewedTask = taskRepo.create({
      id: 'task-gate-reviewed',
      conversation_id: 'project-work',
      title: 'Reviewed task',
      agent_id: 'builder',
    });
    const otherTask = taskRepo.create({
      id: 'task-gate-other',
      conversation_id: 'project-work',
      title: 'Other task',
      agent_id: 'builder',
    });
    const gates = new QualityGateRepository();
    const expectedGate = gates.request({
      conversationId: 'project-work',
      kind: 'code_review',
      targetType: 'task',
      targetId: reviewedTask.id,
      artifactRevision: String(reviewedTask.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now: NOW,
    });
    const mismatchedGate = gates.request({
      conversationId: 'project-work',
      kind: 'code_review',
      targetType: 'task',
      targetId: otherTask.id,
      artifactRevision: String(otherTask.revision),
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now: NOW,
    });
    const repository = new WorkContractRepository();
    const contract = repository.issue({
      workId: `task:${reviewedTask.id}:agent:reviewer:purpose:review`,
      attemptId: 'attempt-gate-review',
      projectId: 'project-work',
      taskId: reviewedTask.id,
      agentId: 'reviewer',
      goal: 'Review the task',
      acceptanceCriteria: ['Record the Gate decision with evidence'],
      role: { name: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`task:${reviewedTask.id}`],
      authoritativeRevisions: { task: reviewedTask.revision },
      contextSnapshotRef: 'ctx-gate-review',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'trace-gate-review',
      causationId: 'trigger-gate-review',
      now: NOW,
    });

    const missingEvidence = repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-gate-missing-evidence',
      idempotencyKey: 'outcome-gate-missing-evidence',
      outcomeType: 'record_gate_decision',
      payload: {
        gateId: expectedGate.gate.id,
        decision: 'passed',
        evidenceType: 'code_review',
      },
    }));
    expect(missingEvidence).toMatchObject({
      status: 'rejected',
      reasonCode: 'gate_outcome_evidence_required',
    });

    const wrongTarget = repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-gate-wrong-target',
      idempotencyKey: 'outcome-gate-wrong-target',
      outcomeType: 'record_gate_decision',
      payload: {
        gateId: mismatchedGate.gate.id,
        decision: 'passed',
        evidenceType: 'code_review',
        evidence: { summary: 'looks good' },
      },
    }));
    expect(wrongTarget).toMatchObject({
      status: 'rejected',
      reasonCode: 'gate_outcome_task_mismatch',
    });

    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-gate-corrected',
      idempotencyKey: 'outcome-gate-corrected',
      outcomeType: 'record_gate_decision',
      payload: {
        gateId: expectedGate.gate.id,
        decision: 'passed',
        evidenceType: 'code_review',
        evidence: { summary: 'looks good' },
      },
    }))).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare(`
      SELECT COUNT(*) AS count FROM agent_outcome
      WHERE contract_id=? AND admission_status='accepted'
    `).get(contract.contractId)).toEqual({ count: 1 });
  });

  it('rejects an invalid Delivery Gate receipt before consuming the terminal slot', () => {
    const delivery = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'delivery-receipt-admission',
      goal: 'Ship the reviewed delivery',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-work' },
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
        requireReview: true,
        requireWebE2E: false,
        requireMerge: false,
      },
    }, NOW).run;
    const gate = new QualityGateRepository().request({
      conversationId: 'project-work',
      kind: 'delivery_review',
      targetType: 'delivery_run',
      targetId: delivery.id,
      artifactRevision: '1',
      criteria: {},
      actor: { type: 'system', id: 'test' },
      now: NOW,
    });
    const repository = new WorkContractRepository();
    const contract = repository.issue({
      workId: `delivery:${delivery.id}:agent:reviewer:gate:${gate.gate.id}:purpose:review`,
      attemptId: 'attempt-delivery-review',
      projectId: 'project-work',
      deliveryRunId: delivery.id,
      agentId: 'reviewer',
      goal: 'Review delivery',
      acceptanceCriteria: ['Works'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`delivery:${delivery.id}`, `gate:${gate.gate.id}`],
      authoritativeRevisions: { deliveryRun: delivery.revision },
      contextSnapshotRef: 'ctx-delivery-review',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'trace-delivery-review',
      causationId: gate.gate.id,
      now: NOW,
    });
    const payload = {
      gateId: gate.gate.id,
      decision: 'passed',
      evidenceType: 'delivery_review',
      evidence: { summary: 'reviewed' },
    };

    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-delivery-review-invalid',
      idempotencyKey: 'outcome-delivery-review-invalid',
      outcomeType: 'record_gate_decision',
      payload,
    }))).toMatchObject({
      status: 'rejected',
      reasonCode: 'gate_outcome_review_receipt_invalid',
    });
    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-delivery-review-corrected',
      idempotencyKey: 'outcome-delivery-review-corrected',
      outcomeType: 'record_gate_decision',
      payload: {
        ...payload,
        receipt: {
          schemaVersion: 1,
          deliveryRunId: delivery.id,
          status: 'passed',
          reviewerAgentId: 'reviewer',
          summary: 'Delivery review passed',
          evidenceRefs: ['report:review'],
          findings: [],
        },
      },
    }))).toMatchObject({ status: 'accepted' });
  });

  it('rejects an otherwise valid outcome after the authoritative Task revision changes', () => {
    taskRepo.create({
      id: 'task-current-revision',
      conversation_id: 'project-work',
      title: 'Revision-bound task',
      agent_id: 'builder',
    });
    const task = taskRepo.getById('task-current-revision')!;
    const repository = new WorkContractRepository();
    const contract = repository.issue({
      workId: 'task:task-current-revision:agent:builder:purpose:execute',
      attemptId: 'attempt-current-revision',
      projectId: 'project-work',
      taskId: task.id,
      agentId: 'builder',
      goal: task.title,
      acceptanceCriteria: ['done'],
      role: {},
      permissions: {},
      authoritativeRefs: [`task:${task.id}`],
      authoritativeRevisions: { task: task.revision },
      contextSnapshotRef: 'ctx-current-revision',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'trace-current-revision',
      causationId: 'trigger-current-revision',
      now: NOW,
    });
    taskRepo.transition(task.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: task.revision,
    });

    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-current-revision',
      idempotencyKey: 'outcome-current-revision',
    }))).toMatchObject({
      status: 'rejected',
      reasonCode: 'task_authoritative_revision_stale',
    });
  });

  it('rejects reuse of an idempotency key with different content', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-conflict' });
    repository.admitOutcome(outcome(contract));
    expect(() => repository.admitOutcome(outcome(contract, {
      outcomeId: 'different-id-is-ignored',
      payload: { summary: 'different' },
    }))).toThrow(AgentOutcomeIdempotencyConflictError);
  });

  it('persists a rejection when the claimed contract does not exist', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-1' });
    const admission = repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-missing-contract',
      idempotencyKey: 'outcome-missing-contract',
      contractId: 'missing-contract',
    }));
    expect(admission).toMatchObject({
      status: 'rejected',
      reasonCode: 'work_contract_missing',
    });
    expect(getDb().prepare(
      'SELECT admission_status,rejection_reason FROM agent_outcome WHERE id=?',
    ).get('outcome-missing-contract')).toEqual({
      admission_status: 'rejected',
      rejection_reason: 'work_contract_missing',
    });
  });

  it('uses compare-and-swap for issue and refuses to reopen closed work', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-1', expectedCurrentEpoch: 0 });
    expect(() => issue(repository, {
      attemptId: 'attempt-stale',
      expectedCurrentEpoch: 0,
    })).toThrow(StaleWorkAuthorityError);

    const closed = repository.close({
      workId: contract.workId,
      expectedEpoch: contract.workEpoch,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      now: NOW,
    });
    expect(closed).toMatchObject({ status: 'closed', revision: 1 });
    expect(repository.admitOutcome(outcome(contract, {
      outcomeId: 'outcome-closed',
      idempotencyKey: 'outcome-closed',
    }))).toMatchObject({
      status: 'rejected',
      reasonCode: 'work_authority_stale',
    });
    expect(() => issue(repository, {
      attemptId: 'attempt-after-close',
      expectedCurrentEpoch: 1,
    })).toThrow(WorkContractInvariantError);
  });

  it('enforces immutable contracts and outcomes while allowing aggregate deletion', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-1' });
    repository.admitOutcome(outcome(contract));

    expect(() => getDb().prepare(
      "UPDATE work_contract SET goal='tampered' WHERE id=?",
    ).run(contract.contractId)).toThrow(/work_contract_immutable/);
    expect(() => getDb().prepare(
      "UPDATE agent_outcome SET payload_json='{}' WHERE contract_id=?",
    ).run(contract.contractId)).toThrow(/agent_outcome_immutable/);
    expect(() => getDb().prepare(
      'DELETE FROM agent_outcome WHERE contract_id=?',
    ).run(contract.contractId)).toThrow(/agent_outcome_immutable/);
    expect(() => getDb().prepare(
      'DELETE FROM work_authority WHERE work_id=?',
    ).run(contract.workId)).toThrow(/work_authority_delete_forbidden/);
    expect(() => getDb().prepare(
      'DELETE FROM work_contract WHERE id=?',
    ).run(contract.contractId)).toThrow(/work_contract_immutable/);

    getDb().prepare('DELETE FROM conversation WHERE id=?').run(contract.projectId);
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM work_contract').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM work_authority').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) AS count FROM agent_outcome').get())
      .toEqual({ count: 0 });
  });

  it('emits the authority and admission event sequence', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-1' });
    repository.admitOutcome(outcome(contract));
    repository.close({
      workId: contract.workId,
      expectedEpoch: contract.workEpoch,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      now: NOW,
    });
    expect(new PlatformEventLog().listStream(`work:${contract.workId}`).map((event) => event.type))
      .toEqual([
        'work.contract.issued',
        'agent.outcome.accepted',
        'work.authority.closed',
      ]);
  });

  it('binds an Invocation to exactly one current WorkContract', () => {
    const repository = new WorkContractRepository();
    const contract = issue(repository, { attemptId: 'attempt-invocation' });
    const invocation = invocationRepo.create({
      id: contract.attemptId,
      conversation_id: contract.projectId,
      task_id: contract.taskId,
      agent_id: contract.agentId,
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    });
    expect(invocation).toMatchObject({
      id: contract.attemptId,
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    });
    expect(() => getDb().prepare(
      "UPDATE invocation SET fencing_token='forged' WHERE id=?",
    ).run(invocation.id)).toThrow(/invocation_work_binding_immutable/);
    expect(() => invocationRepo.create({
      id: 'forged-attempt',
      conversation_id: contract.projectId,
      agent_id: contract.agentId,
      work_contract_id: contract.contractId,
      work_id: contract.workId,
      work_epoch: contract.workEpoch,
      fencing_token: contract.fencingToken,
    })).toThrow(/invalid_invocation_work_binding|UNIQUE/);
  });
});
