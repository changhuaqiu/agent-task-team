import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { A2AOutcomeProcessManager } from './outcome-process-manager';

const NOW = new Date('2026-07-28T11:00:00.000Z');

describe('A2AOutcomeProcessManager', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('project-a2a-outcome', 'A2A Outcome', 'active', NOW.toISOString(), NOW.toISOString());
    const insertAgent = db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES (?,?,'role','default','🤖',?,?)
    `);
    insertAgent.run('lead', 'Lead', NOW.toISOString(), NOW.toISOString());
    insertAgent.run('builder', 'Builder', NOW.toISOString(), NOW.toISOString());
    insertAgent.run('reviewer', 'Reviewer', NOW.toISOString(), NOW.toISOString());
  });

  afterEach(() => resetDb());

  it('turns an accepted structured handoff outcome into one durable fan-out', async () => {
    const contracts = new WorkContractRepository();
    const deliveryRunId = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'a2a-outcome-delivery',
      goal: 'Ship the delegated project',
      acceptanceCriteria: ['All delegated work is complete'],
      scope: { conversationId: 'project-a2a-outcome' },
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
    }, NOW).run.id;
    const contract = contracts.issue({
      workId: 'project-start:lead',
      attemptId: 'inv-lead',
      projectId: 'project-a2a-outcome',
      deliveryRunId,
      agentId: 'lead',
      goal: 'Plan and delegate the project',
      acceptanceCriteria: ['delegate executable work'],
      role: { name: 'lead' },
      permissions: { canDelegate: true },
      authoritativeRefs: ['project:project-a2a-outcome'],
      authoritativeRevisions: { project: 1, deliveryRun: 0 },
      contextSnapshotRef: 'context-lead',
      allowedOutcomeTypes: ['handoff_to_agent'],
      correlationId: 'trace-handoff',
      causationId: 'message-root',
      now: NOW,
    });
    const outcome: AgentOutcome = {
      outcomeId: 'outcome-handoff',
      idempotencyKey: 'outcome-handoff-key',
      contractId: contract.contractId,
      outcomeType: 'handoff_to_agent',
      payload: {
        idempotencyKey: 'handoff-fanout-1',
        branches: [
          {
            toAgentId: 'builder',
            intent: 'implement',
            taskId: 'TASK-1',
            title: 'Implement TASK-1',
            requestedAction: 'Implement the accepted design',
            possessionSummary: 'The design is approved',
            constraints: ['Do not change the public contract'],
          },
          {
            toAgentId: 'reviewer',
            intent: 'review',
            taskId: 'TASK-2',
            title: 'Review TASK-1',
            requestedAction: 'Review the implementation evidence',
          },
        ],
      },
      evidenceRefs: ['docs/design.md'],
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
    expect(contracts.admitOutcome(outcome)).toMatchObject({ status: 'accepted' });
    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const manager = new A2AOutcomeProcessManager({ db: getDb() });

    await manager.handle(event, { signal: new AbortController().signal });
    await manager.handle(event, { signal: new AbortController().signal });

    expect(getDb().prepare(`
      SELECT mode,status,expected_count,source_work_id,delivery_run_id
      FROM a2a_pass_group
    `).all()).toEqual([{
      mode: 'fan_out',
      status: 'offered',
      expected_count: 2,
      source_work_id: contract.workId,
      delivery_run_id: deliveryRunId,
    }]);
    expect(getDb().prepare(`
      SELECT to_agent_id,status FROM a2a_pass ORDER BY to_agent_id
    `).all()).toEqual([
      { to_agent_id: 'builder', status: 'offered' },
      { to_agent_id: 'reviewer', status: 'offered' },
    ]);
    expect(getDb().prepare(`
      SELECT project_agent_id,status,
        json_extract(command_json,'$.passId') pass_id,
        json_extract(command_json,'$.workId') work_id,
        json_extract(command_json,'$.deliveryRunId') delivery_run_id
      FROM agent_inbox_item ORDER BY project_agent_id
    `).all()).toEqual([
      {
        project_agent_id: 'builder',
        status: 'enqueued',
        pass_id: expect.any(String),
        work_id: expect.stringMatching(/^a2a-pass:/),
        delivery_run_id: deliveryRunId,
      },
      {
        project_agent_id: 'reviewer',
        status: 'enqueued',
        pass_id: expect.any(String),
        work_id: expect.stringMatching(/^a2a-pass:/),
        delivery_run_id: deliveryRunId,
      },
    ]);
  });

  it('rejects a target outside the configured platform roster before creating a chain', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'project-start:lead',
      attemptId: 'inv-lead',
      projectId: 'project-a2a-outcome',
      agentId: 'lead',
      goal: 'Delegate',
      acceptanceCriteria: ['delegate'],
      role: {},
      permissions: {},
      authoritativeRefs: ['project:project-a2a-outcome'],
      authoritativeRevisions: { project: 1 },
      contextSnapshotRef: 'context-lead',
      allowedOutcomeTypes: ['handoff_to_agent'],
      correlationId: 'trace-handoff',
      causationId: 'message-root',
      now: NOW,
    });
    contracts.admitOutcome({
      outcomeId: 'outcome-unknown-target',
      idempotencyKey: 'outcome-unknown-target',
      contractId: contract.contractId,
      outcomeType: 'handoff_to_agent',
      payload: {
        idempotencyKey: 'handoff-unknown',
        branches: [{
          toAgentId: 'not-configured',
          intent: 'implement',
          title: 'Implement',
          requestedAction: 'Implement',
        }],
      },
      evidenceRefs: [],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    });
    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;

    expect(() => new A2AOutcomeProcessManager({ db: getDb() }).handle(
      event,
      { signal: new AbortController().signal },
    )).toThrowError(expect.objectContaining({ reasonCode: 'a2a_target_not_in_roster' }));
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_possession_chain').get())
      .toEqual({ count: 0 });
  });
});
