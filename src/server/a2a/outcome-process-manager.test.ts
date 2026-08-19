import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { PlatformEventDispatcher } from '../platform-events/dispatcher';
import { A2ACollaborationRepository } from './collaboration';
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
            evidenceRefs: ['task:TASK-1', 'docs/design.md'],
            constraints: ['Do not change the public contract'],
          },
          {
            toAgentId: 'reviewer',
            intent: 'quality_gate',
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
    const manager = new A2AOutcomeProcessManager({
      db: getDb(),
      commandGuard: {
        assert: () => {
          throw new Error('mutable policy must not be re-evaluated after admission');
        },
      },
    });

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
      SELECT to_agent_id,status,intent FROM a2a_pass ORDER BY to_agent_id
    `).all()).toEqual([
      { to_agent_id: 'builder', status: 'offered', intent: 'implement' },
      { to_agent_id: 'reviewer', status: 'offered', intent: 'verify' },
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
    expect(getDb().prepare(`
      SELECT DISTINCT correlation_id FROM platform_event
      WHERE type IN ('a2a.chain.started','a2a.pass.group_offered','agent.work.enqueued')
    `).all()).toEqual([{ correlation_id: 'trace-handoff' }]);
    expect(getDb().prepare(`
      SELECT json_extract(command_json,'$.correlationId') correlation_id
      FROM agent_inbox_item ORDER BY project_agent_id
    `).all()).toEqual([
      { correlation_id: 'trace-handoff' },
      { correlation_id: 'trace-handoff' },
    ]);
    expect(getDb().prepare(`
      SELECT evidence_refs FROM a2a_handoff_packet
      WHERE to_agent_id='builder'
    `).get()).toEqual({
      evidence_refs: JSON.stringify([
        { label: 'task:TASK-1', taskId: 'TASK-1' },
        { label: 'docs/design.md', path: 'docs/design.md' },
      ]),
    });
  });

  it('rejects a target outside the configured platform roster before creating a chain', () => {
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
    const admission = contracts.admitOutcome({
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
    expect(admission).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_target_not_in_roster',
    });
    expect(new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .some((candidate) => candidate.type === 'agent.outcome.accepted')).toBe(false);
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_possession_chain').get())
      .toEqual({ count: 0 });
  });

  it('rejects duplicate handoff targets atomically before accepting the outcome', () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'project-start:lead',
      attemptId: 'inv-duplicate-target',
      projectId: 'project-a2a-outcome',
      agentId: 'lead',
      goal: 'Delegate once per receiver',
      acceptanceCriteria: ['one branch per receiver'],
      role: {},
      permissions: {},
      authoritativeRefs: ['project:project-a2a-outcome'],
      authoritativeRevisions: { project: 1 },
      contextSnapshotRef: 'context-duplicate-target',
      allowedOutcomeTypes: ['handoff_to_agent'],
      correlationId: 'trace-duplicate-target',
      causationId: 'message-duplicate-target',
      now: NOW,
    });
    const submit = (
      suffix: string,
      targets: string[],
      activeContract = contract,
      handoffKey = `handoff-${suffix}`,
    ) => contracts.admitOutcome({
      outcomeId: `outcome-${suffix}`,
      idempotencyKey: `outcome-${suffix}`,
      contractId: activeContract.contractId,
      outcomeType: 'handoff_to_agent',
      payload: {
        idempotencyKey: handoffKey,
        branches: targets.map((toAgentId, index) => ({
          toAgentId,
          intent: 'implement',
          title: `Implement branch ${index + 1}`,
          requestedAction: `Implement branch ${index + 1}`,
        })),
      },
      evidenceRefs: [],
      projectId: activeContract.projectId,
      workId: activeContract.workId,
      workEpoch: activeContract.workEpoch,
      attemptId: activeContract.attemptId,
      fencingToken: activeContract.fencingToken,
      authoritativeRevisions: activeContract.authoritativeRevisions,
      correlationId: activeContract.correlationId,
      causationId: activeContract.contractId,
      occurredAt: NOW.toISOString(),
    });

    expect(submit('duplicate-target', ['builder', 'builder'])).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_duplicate_group_target',
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_possession_chain').get())
      .toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_pass_group').get())
      .toEqual({ count: 0 });
    expect(submit('corrected-target', ['builder'])).toMatchObject({ status: 'accepted' });
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_pass_group').get())
      .toEqual({ count: 1 });

    const nextContract = contracts.issue({
      workId: contract.workId,
      attemptId: 'inv-conflicting-reuse',
      projectId: contract.projectId,
      agentId: contract.agentId,
      goal: contract.goal,
      acceptanceCriteria: contract.acceptanceCriteria,
      role: contract.role,
      permissions: contract.permissions,
      authoritativeRefs: contract.authoritativeRefs,
      authoritativeRevisions: contract.authoritativeRevisions,
      contextSnapshotRef: 'context-conflicting-reuse',
      allowedOutcomeTypes: ['handoff_to_agent'],
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      now: NOW,
    });
    expect(submit(
      'identical-reuse',
      ['builder'],
      nextContract,
      'handoff-corrected-target',
    )).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_idempotency_conflict',
    });
    expect(submit(
      'conflicting-reuse',
      ['reviewer'],
      nextContract,
      'handoff-corrected-target',
    )).toMatchObject({
      status: 'rejected',
      reasonCode: 'a2a_idempotency_conflict',
    });
    expect(getDb().prepare('SELECT to_agent_id FROM a2a_pass').all())
      .toEqual([{ to_agent_id: 'builder' }]);
  });

  it('does not let a later Work epoch claim an unbound v84 pass group', () => {
    const contracts = new WorkContractRepository();
    const issue = (
      attemptId: string,
      allowedOutcomeTypes: Array<'handoff_to_agent' | 'continue_work'>,
    ) => contracts.issue({
      workId: 'legacy-boundary:lead',
      attemptId,
      projectId: 'project-a2a-outcome',
      agentId: 'lead',
      goal: 'Preserve the original handoff identity',
      acceptanceCriteria: ['later epochs cannot claim an old group'],
      role: {},
      permissions: {},
      authoritativeRefs: ['project:project-a2a-outcome'],
      authoritativeRevisions: { project: 1 },
      contextSnapshotRef: `context-${attemptId}`,
      allowedOutcomeTypes,
      correlationId: 'trace-legacy-boundary',
      causationId: `cause-${attemptId}`,
      now: NOW,
    });
    const handoffPayload = {
      idempotencyKey: 'legacy-stable-handoff-key',
      branches: [{
        toAgentId: 'builder',
        intent: 'implement',
        title: 'Implement the bounded work',
        requestedAction: 'Implement the bounded work',
      }],
    };
    const admit = (
      contract: ReturnType<typeof issue>,
      outcomeId: string,
      outcomeType: 'handoff_to_agent' | 'continue_work',
      payload: Record<string, unknown>,
    ) => contracts.admitOutcome({
      outcomeId,
      idempotencyKey: outcomeId,
      contractId: contract.contractId,
      outcomeType,
      payload,
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

    const original = issue('legacy-original', ['handoff_to_agent']);
    expect(admit(original, 'outcome-legacy-original', 'handoff_to_agent', handoffPayload))
      .toMatchObject({ status: 'accepted' });
    getDb().prepare(`
      UPDATE a2a_pass_group
      SET source_work_epoch=NULL,source_outcome_id=NULL,status='completed',completed_at=?
      WHERE source_work_id=? AND idempotency_key=?
    `).run(NOW.toISOString(), original.workId, handoffPayload.idempotencyKey);

    const callback = issue('legacy-callback', ['continue_work']);
    expect(admit(callback, 'outcome-legacy-callback', 'continue_work', {
      schemaVersion: 1,
      reason: 'multi_step',
      summary: 'Original handoff callback was already processed',
      nextAction: 'Continue with the callback result.',
      completedSteps: ['Processed the original handoff callback.'],
      remainingSteps: ['Continue the source work.'],
    })).toMatchObject({ status: 'accepted' });

    const later = issue('legacy-later-reuse', ['handoff_to_agent']);
    expect(admit(later, 'outcome-legacy-later-reuse', 'handoff_to_agent', handoffPayload))
      .toMatchObject({
        status: 'rejected',
        reasonCode: 'a2a_idempotency_conflict',
      });
    expect(getDb().prepare(`
      SELECT source_work_epoch,source_outcome_id FROM a2a_pass_group
      WHERE source_work_id=? AND idempotency_key=?
    `).get(original.workId, handoffPayload.idempotencyKey)).toEqual({
      source_work_epoch: null,
      source_outcome_id: null,
    });
  });

  it('replays a legacy v2 dead letter through the safely idempotent v3 handler', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'legacy-handoff:lead',
      attemptId: 'legacy-handoff-attempt',
      projectId: 'project-a2a-outcome',
      agentId: 'lead',
      goal: 'Recover the legacy handoff',
      acceptanceCriteria: ['builder receives the work'],
      role: {},
      permissions: {},
      authoritativeRefs: ['project:project-a2a-outcome'],
      authoritativeRevisions: { project: 1 },
      contextSnapshotRef: 'context-legacy-handoff',
      allowedOutcomeTypes: ['handoff_to_agent'],
      correlationId: 'trace-legacy-handoff',
      causationId: 'message-legacy-handoff',
      now: NOW,
    });
    const admission = contracts.admitOutcome({
      outcomeId: 'outcome-legacy-handoff',
      idempotencyKey: 'outcome-legacy-handoff',
      contractId: contract.contractId,
      outcomeType: 'handoff_to_agent',
      payload: {
        idempotencyKey: 'handoff-legacy-v1',
        branches: [{
          toAgentId: 'builder',
          intent: 'quality_gate',
          title: 'Verify the recovered work',
          requestedAction: 'Verify the recovered work',
          evidenceRefs: ['task:TASK-014'],
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
    expect(admission).toMatchObject({ status: 'accepted' });
    const acceptedEvent = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((event) => event.type === 'agent.outcome.accepted')!;

    const acceptedRow = getDb().prepare('SELECT payload_json FROM agent_outcome WHERE id=?')
      .get('outcome-legacy-handoff') as { payload_json: string };
    const legacyPayload = JSON.parse(acceptedRow.payload_json) as Record<string, unknown>;
    delete legacyPayload.idempotencyKey;
    getDb().exec('DROP TRIGGER trg_agent_outcome_immutable');
    getDb().prepare('UPDATE agent_outcome SET payload_json=? WHERE id=?')
      .run(JSON.stringify(legacyPayload), 'outcome-legacy-handoff');
    getDb().exec(`
      CREATE TRIGGER trg_agent_outcome_immutable
      BEFORE UPDATE ON agent_outcome
      BEGIN
        SELECT RAISE(ABORT, 'agent_outcome_immutable');
      END;
    `);

    getDb().prepare('DELETE FROM agent_inbox_item WHERE project_id=?')
      .run(contract.projectId);
    getDb().prepare('DELETE FROM a2a_handoff_packet').run();
    getDb().prepare('DELETE FROM a2a_pass').run();
    getDb().prepare('DELETE FROM a2a_pass_group').run();
    getDb().prepare('DELETE FROM a2a_possession').run();
    getDb().prepare('DELETE FROM a2a_possession_chain WHERE conversation_id=?')
      .run(contract.projectId);
    expect(getDb().prepare('SELECT COUNT(*) count FROM a2a_pass_group').get())
      .toEqual({ count: 0 });

    const recoveryNow = new Date(Date.parse(acceptedEvent.recordedAt) + 1_000);
    let deliveryId = 0;
    const dispatcher = new PlatformEventDispatcher({
      db: getDb(),
      now: () => recoveryNow,
      workerId: 'legacy-recovery-worker',
      idFactory: (prefix) => `${prefix}-legacy-${++deliveryId}`,
      retryDelayMs: () => 0,
    });
    dispatcher.register({
      id: 'a2a-outcome-process-manager:v2',
      pattern: 'agent.outcome.accepted',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: () => undefined,
    });
    expect(dispatcher.recover()).toMatchObject({ enqueued: 1 });
    getDb().prepare(`
      UPDATE platform_event_delivery
      SET status='dead_letter',attempt_count=5,last_error='a2a_outcome_invalid: evidenceRefs[0]'
      WHERE handler_id='a2a-outcome-process-manager:v2' AND event_id=?
    `).run(acceptedEvent.eventId);

    const manager = new A2AOutcomeProcessManager({ db: getDb() });
    dispatcher.register({
      id: 'a2a-outcome-process-manager:v3',
      pattern: 'agent.outcome.accepted',
      stereotype: 'process_manager',
      reliability: 'durable',
      handle: manager.handle,
    });
    expect(dispatcher.recover()).toMatchObject({ enqueued: 1 });
    expect(getDb().prepare(`
      SELECT handler_id,status,next_attempt_at FROM platform_event_delivery
      WHERE event_id=? ORDER BY handler_id
    `).all(acceptedEvent.eventId)).toEqual([
      {
        handler_id: 'a2a-outcome-process-manager:v2',
        status: 'dead_letter',
        next_attempt_at: acceptedEvent.recordedAt,
      },
      {
        handler_id: 'a2a-outcome-process-manager:v3',
        status: 'queued',
        next_attempt_at: acceptedEvent.recordedAt,
      },
    ]);
    expect(await dispatcher.drain()).toMatchObject({ succeeded: 1, deadLettered: 0 });
    expect(getDb().prepare(`
      SELECT handler_id,status FROM platform_event_delivery
      WHERE event_id=? ORDER BY handler_id
    `).all(acceptedEvent.eventId)).toEqual([
      { handler_id: 'a2a-outcome-process-manager:v2', status: 'dead_letter' },
      { handler_id: 'a2a-outcome-process-manager:v3', status: 'succeeded' },
    ]);
    expect(getDb().prepare('SELECT idempotency_key,status FROM a2a_pass_group').all())
      .toEqual([{
        idempotency_key: 'legacy-outcome:outcome-legacy-handoff',
        status: 'offered',
      }]);
  });

  it('closes the exact reconciliation possession bound to a callback WorkContract', async () => {
    const collaboration = new A2ACollaborationRepository({ db: getDb() });
    const chain = collaboration.createChain({
      conversationId: 'project-a2a-outcome',
      rootTriggerType: 'system',
      rootTriggerId: 'callback-root',
      holderId: 'lead',
      holderType: 'agent',
    });
    const offered = collaboration.offerPassGroup({
      chainId: chain.chain.id,
      sourcePossessionId: chain.rootPossession.id,
      sourceWorkId: 'callback-source-work',
      expectedSourceRevision: chain.rootPossession.revision,
      idempotencyKey: 'callback-fanout',
      branches: ['builder', 'reviewer'].map((toAgentId) => ({
        toAgentId,
        intent: 'delegate' as const,
        packet: {
          title: `Work for ${toAgentId}`,
          requestedAction: `Complete ${toAgentId} branch`,
          possessionSummary: `Branch owned by ${toAgentId}`,
          relevantDecisions: [],
          evidenceRefs: [],
          constraints: [],
          openQuestions: [],
          forbiddenBehaviors: [],
          sourceMessageIds: ['callback-root'],
        },
      })),
    });
    for (const pass of offered.passes) {
      const admitted = collaboration.markPassAdmitted(pass.id, pass.revision);
      const starting = collaboration.markPassStarting(admitted.id, admitted.revision);
      const started = collaboration.markPassStarted(starting.id, starting.revision);
      collaboration.completePossession({
        possessionId: started.possession.id,
        expectedRevision: started.possession.revision,
        summary: `${pass.toAgentId} completed`,
      });
    }
    const group = collaboration.getGroup(offered.group.id)!;
    const reconciliation = collaboration.getPossession(group.recoveryPossessionId!)!;
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'callback-source-work',
      attemptId: 'callback-attempt',
      projectId: 'project-a2a-outcome',
      agentId: 'lead',
      goal: 'Synthesize parallel results',
      acceptanceCriteria: ['Return one result'],
      role: {},
      permissions: {},
      authoritativeRefs: [`a2a_possession:${reconciliation.id}`],
      authoritativeRevisions: { a2aPossession: reconciliation.revision },
      contextSnapshotRef: 'callback-context',
      allowedOutcomeTypes: ['submit_task_result'],
      correlationId: 'callback-trace',
      causationId: reconciliation.id,
      now: NOW,
    });
    expect(contracts.admitOutcome({
      outcomeId: 'callback-outcome',
      idempotencyKey: 'callback-outcome',
      contractId: contract.contractId,
      outcomeType: 'submit_task_result',
      payload: { summary: 'Parallel work synthesized' },
      evidenceRefs: ['callback:final'],
      projectId: contract.projectId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId,
      causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'accepted' });
    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;

    await new A2AOutcomeProcessManager({ db: getDb(), collaboration })
      .handle(event, { signal: new AbortController().signal });

    expect(collaboration.getPossession(reconciliation.id)).toMatchObject({
      status: 'completed',
      summary: 'Parallel work synthesized',
    });
    expect(collaboration.getGroup(group.id)).toMatchObject({ status: 'completed' });
    expect(collaboration.getChain(chain.chain.id)).toMatchObject({ status: 'completed' });
  });

  it.each([
    ['report_blocked', 'dependency_unavailable'],
    ['request_human_decision', 'human_decision_requested'],
  ] as const)(
    'does not count %s as a successful A2A branch',
    async (outcomeType, expectedReason) => {
      const collaboration = new A2ACollaborationRepository({ db: getDb() });
      const chain = collaboration.createChain({
        conversationId: 'project-a2a-outcome',
        rootTriggerType: 'user_turn',
        rootTriggerId: `message-${outcomeType}`,
        holderId: 'lead',
        holderType: 'agent',
      });
      const offered = collaboration.offerPassGroup({
        chainId: chain.chain.id,
        sourcePossessionId: chain.rootPossession.id,
        sourceWorkId: `source-${outcomeType}`,
        expectedSourceRevision: chain.rootPossession.revision,
        idempotencyKey: `offer-${outcomeType}`,
        branches: [{
          toAgentId: 'builder',
          intent: 'implement',
          packet: {
            title: 'Implement branch',
            requestedAction: 'Implement it',
            possessionSummary: 'Branch work',
            relevantDecisions: [],
            evidenceRefs: [],
            constraints: [],
            openQuestions: [],
            forbiddenBehaviors: [],
            sourceMessageIds: [`message-${outcomeType}`],
          },
        }],
      });
      const admittedPass = collaboration.markPassAdmitted(
        offered.passes[0]!.id,
        offered.passes[0]!.revision,
      );
      const startingPass = collaboration.markPassStarting(
        admittedPass.id,
        admittedPass.revision,
      );
      const started = collaboration.markPassStarted(
        startingPass.id,
        startingPass.revision,
      );
      const contracts = new WorkContractRepository();
      const contract = contracts.issue({
        workId: `a2a-work-${outcomeType}`,
        attemptId: `inv-${outcomeType}`,
        projectId: 'project-a2a-outcome',
        agentId: 'builder',
        goal: 'Complete delegated work',
        acceptanceCriteria: ['return a structured outcome'],
        role: {},
        permissions: {},
        authoritativeRefs: [`a2a_pass:${started.pass.id}`],
        authoritativeRevisions: { project: 1 },
        contextSnapshotRef: `context-${outcomeType}`,
        allowedOutcomeTypes: [outcomeType],
        correlationId: `trace-${outcomeType}`,
        causationId: started.pass.id,
        now: NOW,
      });
      contracts.admitOutcome({
        outcomeId: `outcome-${outcomeType}`,
        idempotencyKey: `outcome-${outcomeType}`,
        contractId: contract.contractId,
        outcomeType,
        payload: outcomeType === 'report_blocked'
          ? { reasonCode: 'dependency_unavailable', summary: 'Dependency is unavailable' }
          : { question: 'Choose a migration strategy' },
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

      await new A2AOutcomeProcessManager({
        db: getDb(),
        collaboration,
      }).handle(event, { signal: new AbortController().signal });

      expect(collaboration.getPass(started.pass.id)).toMatchObject({
        status: 'blocked',
        reason: expectedReason,
        phase: 'run',
      });
      expect(collaboration.getPossession(started.possession.id)).toMatchObject({
        status: 'aborted',
      });
      expect(collaboration.getGroup(offered.group.id)).toMatchObject({
        status: 'recovering',
        resolvedCount: 1,
        recoveryPossessionId: expect.any(String),
      });
      expect(collaboration.getChain(chain.chain.id)).toMatchObject({ status: 'active' });
    },
  );
});
