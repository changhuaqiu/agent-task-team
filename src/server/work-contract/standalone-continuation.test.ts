import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { admitDispatch } from '../invocation-pipeline/dispatch-admission';
import type { AgentActivationCommand } from '../invocation-pipeline/types';
import { WorkContractRepository } from './repository';
import type { AgentOutcome, WorkContract } from './types';

const NOW = new Date('2026-08-29T16:00:00.000Z');

describe('standalone Work continuation', () => {
  let db: Database.Database;
  let contracts: WorkContractRepository;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    contracts = new WorkContractRepository();
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-continue','Continue','active',?,?)
    `).run(NOW.toISOString(), NOW.toISOString());
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function issue(epoch: number): WorkContract {
    return contracts.issue({
      workId: 'standalone:long-work', attemptId: `inv-${epoch}`, projectId: 'project-continue',
      agentId: 'mario', goal: 'Complete long work', acceptanceCriteria: ['Finish every step'], role: {},
      permissions: { executionProfile: { stage: 'plan' } },
      authoritativeRefs: ['task_graph:project-continue'],
      authoritativeRevisions: { taskGraph: 0 }, contextSnapshotRef: `context-${epoch}`,
      allowedOutcomeTypes: ['continue_work'], correlationId: 'trace-continue',
      causationId: `request-${epoch}`, now: new Date(NOW.getTime() + epoch),
    });
  }

  function continuation(contract: WorkContract, epoch: number): AgentOutcome {
    return {
      outcomeId: `outcome-${epoch}`, idempotencyKey: `continue-${epoch}`,
      contractId: contract.contractId, outcomeType: 'continue_work',
      payload: {
        schemaVersion: 1, reason: 'context_boundary', summary: `completed ${epoch}`,
        nextAction: `continue ${epoch + 1}`, completedSteps: [`step ${epoch}`],
        remainingSteps: ['finish'],
      },
      evidenceRefs: [`evidence-${epoch}`], projectId: contract.projectId,
      workId: contract.workId, workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: new Date(NOW.getTime() + epoch).toISOString(),
    };
  }

  it('queues the next fenced epoch before returning accepted and replays idempotently', () => {
    const contract = issue(1);
    const candidate = continuation(contract, 1);

    expect(contracts.admitOutcome(candidate)).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare(`
      SELECT project_agent_id,status,json_extract(command_json,'$.workId') work_id,
        json_extract(command_json,'$.source') source,json_extract(command_json,'$.prompt') prompt
      FROM agent_inbox_item
    `).get()).toMatchObject({
      project_agent_id: 'mario', status: 'enqueued', work_id: 'standalone:long-work',
      source: 'system', prompt: expect.stringContaining('精确下一动作：continue 2'),
    });

    expect(contracts.admitOutcome(candidate)).toMatchObject({ status: 'duplicate' });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 1 });
  });

  it('rejects a fourth standalone continuation before consuming another exit', () => {
    for (let epoch = 1; epoch <= 3; epoch += 1) {
      const contract = issue(epoch);
      expect(contracts.admitOutcome(continuation(contract, epoch))).toMatchObject({ status: 'accepted' });
    }
    const exhausted = issue(4);
    expect(contracts.admitOutcome(continuation(exhausted, 4))).toMatchObject({
      status: 'rejected', reasonCode: 'continuation_budget_exhausted',
    });
    expect(getDb().prepare(`
      SELECT COUNT(*) count FROM agent_outcome
      WHERE admission_status='accepted' AND outcome_type='continue_work'
    `).get()).toEqual({ count: 3 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 3 });
  });

  it('preserves A2A possession authority in the queued continuation', () => {
    db.prepare(`
      INSERT INTO a2a_possession_chain (
        id,conversation_id,root_trigger_type,root_trigger_id,status,current_holder_id,
        config,revision,created_at,updated_at,completed_at
      ) VALUES ('chain-continue','project-continue','system','root','active','mario',
        '{}',0,?,?,NULL)
    `).run(NOW.toISOString(), NOW.toISOString());
    db.prepare(`
      INSERT INTO a2a_possession (
        id,chain_id,holder_id,holder_type,status,parent_pass_id,revision,
        started_at,updated_at,completed_at,summary
      ) VALUES ('possession-continue','chain-continue','mario','agent','open',NULL,0,
        ?,?,NULL,NULL)
    `).run(NOW.toISOString(), NOW.toISOString());
    const contract = contracts.issue({
      workId: 'a2a:continued-work', attemptId: 'inv-a2a', projectId: 'project-continue',
      agentId: 'mario', goal: 'Continue A2A work', acceptanceCriteria: ['Reconcile work'],
      role: {}, permissions: { executionProfile: { stage: 'recover' } },
      authoritativeRefs: ['a2a_possession:possession-continue'],
      authoritativeRevisions: { a2aPossession: 0 }, contextSnapshotRef: 'context-a2a',
      allowedOutcomeTypes: ['continue_work'], correlationId: 'trace-a2a',
      causationId: 'request-a2a', now: NOW,
    });

    expect(contracts.admitOutcome(continuation(contract, 9))).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare(`
      SELECT json_extract(command_json,'$.source') source,
        json_extract(command_json,'$.chainId') chain_id,
        json_extract(command_json,'$.possessionId') possession_id,
        json_extract(command_json,'$.possessionRevision') possession_revision
      FROM agent_inbox_item
    `).get()).toEqual({
      source: 'a2a', chain_id: 'chain-continue', possession_id: 'possession-continue',
      possession_revision: 0,
    });
  });

  it('keeps a task-bound outcome-recovery continuation command-only', () => {
    taskRepo.create({
      id: 'task-recovery', conversation_id: 'project-continue', title: 'Recover outcome', agent_id: 'mario',
    });
    const contract = contracts.issue({
      workId: 'task:task-recovery', attemptId: 'inv-recovery', projectId: 'project-continue',
      taskId: 'task-recovery', agentId: 'mario', goal: 'Submit the prior outcome',
      acceptanceCriteria: ['Submit one outcome'], role: {},
      permissions: { executionMode: 'outcome_recovery', executionProfile: { stage: 'recover' } },
      authoritativeRefs: ['task:task-recovery'], authoritativeRevisions: { task: 0 },
      contextSnapshotRef: 'context-recovery', allowedOutcomeTypes: ['continue_work'],
      correlationId: 'trace-recovery', causationId: 'request-recovery', now: NOW,
    });

    expect(contracts.admitOutcome(continuation(contract, 10))).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare(`
      SELECT json_extract(command_json,'$.taskId') task_id,
        json_extract(command_json,'$.executionMode') execution_mode,
        json_extract(command_json,'$.contextScenario') context_scenario
      FROM agent_inbox_item
    `).get()).toEqual({
      task_id: 'task-recovery', execution_mode: 'outcome_recovery', context_scenario: 'recovery',
    });
  });

  it('preserves an ad-hoc execution subject across continuation', () => {
    const contract = contracts.issue({
      workId: 'ad-hoc:interview', attemptId: 'inv-ad-hoc', projectId: 'project-continue',
      agentId: 'mario', goal: 'Continue the interview', acceptanceCriteria: ['Finish interview'],
      role: {}, permissions: { executionMode: 'standard', executionProfile: { stage: 'execute' } },
      authoritativeRefs: ['ad_hoc_execution:interview-session'], authoritativeRevisions: {},
      contextSnapshotRef: 'context-ad-hoc', allowedOutcomeTypes: ['continue_work'],
      correlationId: 'trace-ad-hoc', causationId: 'request-ad-hoc', now: NOW,
    });

    expect(contracts.admitOutcome(continuation(contract, 11))).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare(`
      SELECT json_extract(command_json,'$.executionMode') execution_mode,
        json_extract(command_json,'$.executionSubject.kind') subject_kind,
        json_extract(command_json,'$.executionSubject.id') subject_id
      FROM agent_inbox_item
    `).get()).toEqual({
      execution_mode: 'standard', subject_kind: 'ad_hoc_execution', subject_id: 'interview-session',
    });
  });

  it.each([
    ['plan', 'planning'],
    ['close', 'closure'],
  ] as const)('keeps a task-bound %s continuation in its non-execution stage', (stage, scenario) => {
    const taskId = `task-${stage}`;
    taskRepo.create({
      id: taskId, conversation_id: 'project-continue', title: `${stage} work`, agent_id: 'mario',
    });
    const contract = contracts.issue({
      workId: `${stage}:continued-work`, attemptId: `inv-${stage}`, projectId: 'project-continue',
      taskId, agentId: 'mario', goal: `Continue ${stage}`, acceptanceCriteria: ['Keep stage'],
      role: {}, permissions: { executionMode: 'standard', executionProfile: { stage } },
      authoritativeRefs: [`task:${taskId}`], authoritativeRevisions: { task: 0 },
      contextSnapshotRef: `context-${stage}`, allowedOutcomeTypes: ['continue_work'],
      correlationId: `trace-${stage}`, causationId: `request-${stage}`, now: NOW,
    });

    expect(contracts.admitOutcome(continuation(contract, stage === 'plan' ? 12 : 13)))
      .toMatchObject({ status: 'accepted' });
    const command = JSON.parse((getDb().prepare(`
      SELECT command_json FROM agent_inbox_item
      WHERE json_extract(command_json,'$.workId')=?
    `).get(contract.workId) as { command_json: string }).command_json) as AgentActivationCommand;
    expect(command.contextScenario).toBe(scenario);
    const admission = admitDispatch({
      trigger: command,
      task: taskRepo.getById(taskId),
      agent: {
        id: 'mario', displayName: 'Mario', instructions: '', responsibility: 'specialist',
        canModifyCode: true, canReview: false,
      },
      definitionRevision: 1,
    });
    expect(admission).toMatchObject({
      ok: true,
      grant: { kind: stage === 'plan' ? 'planning' : 'closure', allowCodeChanges: false },
    });
  });
});
