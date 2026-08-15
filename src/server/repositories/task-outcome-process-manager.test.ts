import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { GateOutcomeProcessManager } from '../quality-gate/outcome-process-manager';
import { QualityGateRepository } from '../quality-gate/repository';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome, WorkContract } from '../work-contract/types';
import { TaskGateLifecycleProcessManager } from './task-gate-lifecycle-process-manager';
import { taskGraphRepo } from './task-graph-repo';
import { TaskOutcomeProcessManager } from './task-outcome-process-manager';
import { taskRepo } from './task-repo';

const NOW = new Date('2026-07-28T08:00:00.000Z');
const SIGNAL = new AbortController().signal;

function issueExecution(): WorkContract {
  const task = taskRepo.getById('task-1')!;
  return new WorkContractRepository().issue({
    workId: 'task:task-1:agent:builder:purpose:execute',
    attemptId: 'inv-execution',
    projectId: 'project-1',
    taskId: task.id,
    agentId: 'builder',
    goal: task.title,
    acceptanceCriteria: ['implementation complete', 'evidence attached'],
    role: { id: 'builder' },
    permissions: {},
    authoritativeRefs: [`task:${task.id}`],
    authoritativeRevisions: { task: task.revision },
    contextSnapshotRef: 'context-1',
    allowedOutcomeTypes: ['submit_task_result', 'request_review', 'report_blocked'],
    correlationId: 'trace-root',
    causationId: 'activate-1',
    now: NOW,
  });
}

function submit(contract: WorkContract): AgentOutcome {
  return {
    outcomeId: 'outcome-task-result',
    idempotencyKey: 'outcome-task-result',
    contractId: contract.contractId,
    outcomeType: 'submit_task_result',
    payload: { summary: 'Implemented and tested' },
    evidenceRefs: ['src/feature.ts', 'test:vitest-passed'],
    projectId: contract.projectId,
    workId: contract.workId,
    workEpoch: contract.workEpoch,
    attemptId: contract.attemptId,
    fencingToken: contract.fencingToken,
    authoritativeRevisions: contract.authoritativeRevisions,
    correlationId: contract.correlationId,
    causationId: contract.contractId,
    occurredAt: NOW.toISOString(),
  };
}

function acceptedEvent(outcomeId: string) {
  return getDb().prepare(`
    SELECT id FROM platform_event
    WHERE aggregate_type='agent_outcome' AND aggregate_id=? AND type='agent.outcome.accepted'
  `).get(outcomeId) as { id: string };
}

describe('Task outcome and Gate lifecycle process managers', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-1', 'Project', 'active', NOW.toISOString(), NOW.toISOString());
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'project-1',
      title: 'Implement feature',
      agent_id: 'builder',
    });
    const task = taskRepo.getById('task-1')!;
    taskRepo.transition(task.id, {
      to: 'in_progress',
      expectedFrom: 'ready',
      expectedRevision: task.revision,
    });
  });

  afterEach(() => resetDb());

  it('turns an accepted task result into reviewable Task facts exactly once', async () => {
    const contract = issueExecution();
    const admitted = new WorkContractRepository().admitOutcome(submit(contract), NOW);
    expect(admitted).toMatchObject({ status: 'accepted' });
    const event = new PlatformEventLog().getById(
      acceptedEvent('outcome-task-result').id,
    )!;
    const manager = new TaskOutcomeProcessManager();

    await manager.handle(event, { signal: SIGNAL });
    await manager.handle(event, { signal: SIGNAL });

    expect(taskRepo.getById('task-1')).toMatchObject({
      status: 'in_review',
      revision: 2,
      review_note: 'Implemented and tested',
    });
    expect(taskGraphRepo.listActionsForTask('task-1').filter((action) =>
      action.proof_event_id === event.eventId
    )).toHaveLength(1);
    expect(taskGraphRepo.getGraph('project-1').artifacts).toMatchObject([
      { task_id: 'task-1', path: 'src/feature.ts' },
      { task_id: 'task-1', path: 'test:vitest-passed' },
    ]);
  });

  it('[scenario:task-review-closure] consumes reviewer Outcome, completes Task and closes authorities', async () => {
    const contracts = new WorkContractRepository();
    const execution = issueExecution();
    contracts.admitOutcome(submit(execution), NOW);
    const outcomeEvent = new PlatformEventLog().getById(
      acceptedEvent('outcome-task-result').id,
    )!;
    await new TaskOutcomeProcessManager().handle(outcomeEvent, { signal: SIGNAL });
    const task = taskRepo.getById('task-1')!;
    const gateRepo = new QualityGateRepository();
    const requested = gateRepo.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'control' },
      now: NOW,
    });
    const reviewer = contracts.issue({
      workId: 'task:task-1:agent:reviewer:purpose:review',
      attemptId: 'inv-review',
      projectId: 'project-1',
      taskId: task.id,
      agentId: 'reviewer',
      goal: 'Review task',
      acceptanceCriteria: ['record decision'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`task:${task.id}`],
      authoritativeRevisions: { task: task.revision },
      contextSnapshotRef: 'context-review',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'trace-root',
      causationId: requested.gate.id,
      now: NOW,
    });
    contracts.admitOutcome({
      outcomeId: 'outcome-gate-passed',
      idempotencyKey: 'outcome-gate-passed',
      contractId: reviewer.contractId,
      outcomeType: 'record_gate_decision',
      payload: {
        gateId: requested.gate.id,
        decision: 'passed',
        evidenceType: 'code_review',
        evidence: { noMaterialFindings: true },
      },
      evidenceRefs: ['review:passed'],
      projectId: reviewer.projectId,
      workId: reviewer.workId,
      workEpoch: reviewer.workEpoch,
      attemptId: reviewer.attemptId,
      fencingToken: reviewer.fencingToken,
      authoritativeRevisions: reviewer.authoritativeRevisions,
      correlationId: reviewer.correlationId,
      causationId: reviewer.contractId,
      occurredAt: NOW.toISOString(),
    }, NOW);
    const reviewerEvent = new PlatformEventLog().getById(
      acceptedEvent('outcome-gate-passed').id,
    )!;
    await new GateOutcomeProcessManager().handle(reviewerEvent, {
      signal: SIGNAL,
    });
    const gateEvent = new PlatformEventLog()
      .listStream(`quality_gate:${requested.gate.id}`)
      .find((event) => event.type === 'gate.passed')!;

    await new TaskGateLifecycleProcessManager().handle(gateEvent, { signal: SIGNAL });

    expect(taskRepo.getById(task.id)).toMatchObject({ status: 'done', revision: 3 });
    expect(contracts.getAuthority(execution.workId)).toMatchObject({ status: 'closed' });
    expect(contracts.getAuthority('task:task-1:agent:reviewer:purpose:review'))
      .toMatchObject({ status: 'closed' });
  });

  it('returns changes-requested work to execution while fencing only the reviewer', async () => {
    const contracts = new WorkContractRepository();
    const execution = issueExecution();
    contracts.admitOutcome(submit(execution), NOW);
    await new TaskOutcomeProcessManager().handle(
      new PlatformEventLog().getById(acceptedEvent('outcome-task-result').id)!,
      { signal: SIGNAL },
    );
    const task = taskRepo.getById('task-1')!;
    const gates = new QualityGateRepository();
    const requested = gates.request({
      conversationId: 'project-1',
      kind: 'code_review',
      targetType: 'task',
      targetId: task.id,
      artifactRevision: String(task.revision),
      criteria: {},
      actor: { type: 'system', id: 'control' },
      now: NOW,
    });
    contracts.issue({
      workId: 'task:task-1:agent:reviewer:purpose:review',
      attemptId: 'inv-review',
      projectId: 'project-1',
      taskId: task.id,
      agentId: 'reviewer',
      goal: 'Review task',
      acceptanceCriteria: ['record decision'],
      role: { id: 'reviewer' },
      permissions: {},
      authoritativeRefs: [`task:${task.id}`],
      authoritativeRevisions: { task: task.revision },
      contextSnapshotRef: 'context-review',
      allowedOutcomeTypes: ['record_gate_decision'],
      correlationId: 'trace-root',
      causationId: requested.gate.id,
      now: NOW,
    });
    const evaluating = gates.beginEvaluation({
      gateId: requested.gate.id,
      evaluator: { type: 'agent', id: 'reviewer' },
      expectedRevision: requested.gate.revision,
      now: NOW,
    });
    const evidence = gates.submitEvidence({
      gateId: requested.gate.id,
      evidenceType: 'review',
      payload: { finding: 'fix race' },
      actor: { type: 'agent', id: 'reviewer' },
      idempotencyKey: 'review-evidence',
      now: NOW,
    });
    gates.decide({
      gateId: requested.gate.id,
      decision: 'changes_requested',
      evaluator: { type: 'agent', id: 'reviewer' },
      evidenceIds: [evidence.id],
      reason: 'Fix race',
      expectedRevision: evaluating.gate.revision,
      now: NOW,
    });
    const gateEvent = new PlatformEventLog()
      .listStream(`quality_gate:${requested.gate.id}`)
      .find((event) => event.type === 'gate.changes_requested')!;

    await new TaskGateLifecycleProcessManager().handle(gateEvent, { signal: SIGNAL });

    expect(taskRepo.getById(task.id)).toMatchObject({
      status: 'in_progress',
      revision: 3,
      review_note: 'Fix race',
    });
    expect(contracts.getAuthority(execution.workId)).toMatchObject({ status: 'active' });
    expect(contracts.getAuthority('task:task-1:agent:reviewer:purpose:review'))
      .toMatchObject({ status: 'closed' });
  });
});
