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
