import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestReceipt } from '@/lib/engineering-collaboration/types';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import type { GitProviderVerifier } from '../engineering-collaboration/git-provider';
import { EngineeringCollaborationService } from '../engineering-collaboration/service';
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

function issueExecution(suffix = 'execution'): WorkContract {
  const task = taskRepo.getById('task-1')!;
  return new WorkContractRepository().issue({
    workId: 'task:task-1:agent:builder:purpose:execute',
    attemptId: `inv-${suffix}`,
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

function submit(
  contract: WorkContract,
  overrides: Partial<AgentOutcome> = {},
): AgentOutcome {
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
    ...overrides,
  };
}

const PULL_REQUEST: PullRequestReceipt = {
  provider: 'github',
  repository: 'acme/widget',
  number: 42,
  title: 'Implement feature',
  url: 'https://github.com/acme/widget/pull/42',
  state: 'open',
  draft: false,
  author: 'builder',
  baseRef: 'main',
  headRef: 'feature/task-1',
  headSha: 'a'.repeat(40),
  checks: 'passing',
  verifiedAt: NOW.toISOString(),
};

function gitVerifier(
  pullRequest: PullRequestReceipt = PULL_REQUEST,
): GitProviderVerifier {
  return {
    getPullRequest: vi.fn(async () => pullRequest),
    getReview: vi.fn(async () => {
      throw new Error('review_not_expected');
    }),
    getMerge: vi.fn(async () => {
      throw new Error('merge_not_expected');
    }),
  };
}

function gitBackedSubmission(
  contract: WorkContract,
  overrides: Partial<AgentOutcome> = {},
): AgentOutcome {
  return submit(contract, {
    payload: {
      summary: 'Implemented and tested',
      pullRequestUrl: PULL_REQUEST.url,
      implementationEvidence: {
        installResult: 'pnpm install unchanged',
        buildResult: 'pnpm build passed',
        testResult: 'pnpm test passed',
        impactEvidence: 'feature behavior and affected callers inspected',
      },
    },
    evidenceRefs: [PULL_REQUEST.url, 'test:vitest-passed'],
    ...overrides,
  });
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

  it('uses a provider-verified pull request as the only review transition for Git-backed work', async () => {
    getDb().prepare('UPDATE conversation SET git_repo_root=? WHERE id=?')
      .run('C:/repo', 'project-1');
    const contract = issueExecution();
    const submitted = gitBackedSubmission(contract);
    new WorkContractRepository().admitOutcome(submitted, NOW);
    const event = new PlatformEventLog().getById(acceptedEvent(submitted.outcomeId).id)!;
    const verifier = gitVerifier();
    const manager = new TaskOutcomeProcessManager(new EngineeringCollaborationService(verifier));

    await manager.handle(event, { signal: SIGNAL });
    await manager.handle(event, { signal: SIGNAL });

    expect(verifier.getPullRequest).toHaveBeenCalledOnce();
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_review', revision: 2 });
    const pullRequestActions = taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.pull_request_submitted');
    expect(pullRequestActions).toHaveLength(1);
    expect(JSON.parse(pullRequestActions[0].payload)).toMatchObject({
      outcomeId: submitted.outcomeId,
      receipt: { url: PULL_REQUEST.url, headSha: PULL_REQUEST.headSha },
    });
    expect(taskGraphRepo.getGraph('project-1').artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ task_id: 'task-1', url: PULL_REQUEST.url }),
    ]));
  });

  it('does not mutate a Git-backed task when provider verification rejects the pull request', async () => {
    getDb().prepare('UPDATE conversation SET git_repo_root=? WHERE id=?')
      .run('C:/repo', 'project-1');
    const contract = issueExecution();
    const submitted = gitBackedSubmission(contract);
    new WorkContractRepository().admitOutcome(submitted, NOW);
    const event = new PlatformEventLog().getById(acceptedEvent(submitted.outcomeId).id)!;
    const rejectedReceipt: PullRequestReceipt = {
      ...PULL_REQUEST,
      state: 'closed',
    };
    const manager = new TaskOutcomeProcessManager(
      new EngineeringCollaborationService(gitVerifier(rejectedReceipt)),
    );

    await expect(manager.handle(event, { signal: SIGNAL }))
      .rejects.toThrow('Pull request #42 is closed');

    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_progress', revision: 1 });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.pull_request_submitted')).toHaveLength(0);
  });

  it('does not verify or mutate a Git-backed task whose accepted Outcome became stale in the queue', async () => {
    getDb().prepare('UPDATE conversation SET git_repo_root=? WHERE id=?')
      .run('C:/repo', 'project-1');
    const contract = issueExecution();
    const submitted = gitBackedSubmission(contract);
    new WorkContractRepository().admitOutcome(submitted, NOW);
    const current = taskRepo.getById('task-1')!;
    taskRepo.update(current.id, { description: 'changed after admission' });
    const event = new PlatformEventLog().getById(acceptedEvent(submitted.outcomeId).id)!;
    const verifier = gitVerifier();
    const manager = new TaskOutcomeProcessManager(new EngineeringCollaborationService(verifier));

    await expect(manager.handle(event, { signal: SIGNAL }))
      .rejects.toThrow('task_outcome_task_revision_stale:expected=1:actual=2');

    expect(verifier.getPullRequest).not.toHaveBeenCalled();
    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_progress', revision: 2 });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.pull_request_submitted')).toHaveLength(0);
  });

  it('fences a Git-backed task revision that changes while provider verification is in flight', async () => {
    getDb().prepare('UPDATE conversation SET git_repo_root=? WHERE id=?')
      .run('C:/repo', 'project-1');
    const contract = issueExecution();
    const submitted = gitBackedSubmission(contract);
    new WorkContractRepository().admitOutcome(submitted, NOW);
    const event = new PlatformEventLog().getById(acceptedEvent(submitted.outcomeId).id)!;
    let releaseVerification!: (receipt: PullRequestReceipt) => void;
    const pendingReceipt = new Promise<PullRequestReceipt>((resolve) => {
      releaseVerification = resolve;
    });
    const verifier: GitProviderVerifier = {
      ...gitVerifier(),
      getPullRequest: vi.fn(() => pendingReceipt),
    };
    const manager = new TaskOutcomeProcessManager(new EngineeringCollaborationService(verifier));
    const processing = manager.handle(event, { signal: SIGNAL });
    await vi.waitFor(() => expect(verifier.getPullRequest).toHaveBeenCalledOnce());
    const current = taskRepo.getById('task-1')!;
    taskRepo.update(current.id, { description: 'changed during provider verification' });
    releaseVerification(PULL_REQUEST);

    await expect(processing).rejects.toThrow('Task task-1 revision changed from 1 to 2');

    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_progress', revision: 2 });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.pull_request_submitted')).toHaveLength(0);
  });

  it('rejects stale Git-backed rework without accepting an unchanged pull request head', async () => {
    getDb().prepare('UPDATE conversation SET git_repo_root=? WHERE id=?')
      .run('C:/repo', 'project-1');
    const contracts = new WorkContractRepository();
    const firstContract = issueExecution('first');
    const firstSubmission = gitBackedSubmission(firstContract);
    contracts.admitOutcome(firstSubmission, NOW);
    const manager = new TaskOutcomeProcessManager(
      new EngineeringCollaborationService(gitVerifier()),
    );
    await manager.handle(
      new PlatformEventLog().getById(acceptedEvent(firstSubmission.outcomeId).id)!,
      { signal: SIGNAL },
    );
    const inReview = taskRepo.getById('task-1')!;
    taskRepo.transition(inReview.id, {
      to: 'in_progress',
      expectedFrom: 'in_review',
      expectedRevision: inReview.revision,
    });
    const secondContract = issueExecution('second');
    const secondSubmission = gitBackedSubmission(secondContract, {
      outcomeId: 'outcome-task-result-rework',
      idempotencyKey: 'outcome-task-result-rework',
      attemptId: secondContract.attemptId,
      workEpoch: secondContract.workEpoch,
      fencingToken: secondContract.fencingToken,
      authoritativeRevisions: secondContract.authoritativeRevisions,
      contractId: secondContract.contractId,
      causationId: secondContract.contractId,
    });
    contracts.admitOutcome(secondSubmission, NOW);
    const event = new PlatformEventLog().getById(
      acceptedEvent(secondSubmission.outcomeId).id,
    )!;

    await expect(manager.handle(event, { signal: SIGNAL }))
      .rejects.toThrow('The pull request head has not changed');

    expect(taskRepo.getById('task-1')).toMatchObject({ status: 'in_progress', revision: 3 });
    expect(taskGraphRepo.listActionsForTask('task-1')
      .filter((action) => action.type === 'task.pull_request_submitted')).toHaveLength(1);
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
