import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { PlatformEventLog } from '../platform-events/event-log';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import { WorkContractRepository } from '../work-contract/repository';
import type { AgentOutcome } from '../work-contract/types';
import { taskGraphRepo } from './task-graph-repo';
import { taskRepo } from './task-repo';
import { TaskGraphOutcomeProcessManager } from './task-graph-outcome-process-manager';
import { TaskGraphSchedulerProcessManager } from './task-graph-scheduler-process-manager';

const NOW = new Date('2026-07-28T13:00:00.000Z');

describe('TaskGraphOutcomeProcessManager', () => {
  beforeEach(() => {
    const db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO project (id,name,root_path,created_at,updated_at)
      VALUES ('project-row','Task Graph','C:/task-graph',?,?)
    `).run(NOW.toISOString(), NOW.toISOString());
    db.prepare(`
      INSERT INTO conversation (
        id,title,status,created_at,updated_at,project_id,workspace_kind
      ) VALUES ('project-task-graph','Task Graph','active',?,?,'project-row','project_workspace')
    `).run(NOW.toISOString(), NOW.toISOString());
    for (const [id, name] of [['planner', 'Planner'], ['builder', 'Builder'], ['reviewer', 'Reviewer']]) {
      db.prepare(`
        INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
        VALUES (?,?,'role','default','🤖',?,?)
      `).run(id, name, NOW.toISOString(), NOW.toISOString());
      db.prepare(`
        INSERT INTO project_agent_membership (project_id,agent_id,source,added_at)
        VALUES ('project-row',?,'manual',?)
      `).run(id, NOW.toISOString());
    }
  });

  afterEach(() => resetDb());

  it('atomically commits an accepted proposal and replays it idempotently', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'delivery:plan',
      attemptId: 'inv-plan',
      projectId: 'project-task-graph',
      agentId: 'planner',
      goal: 'Create the project Task Graph',
      acceptanceCriteria: ['Return an acyclic graph'],
      role: { id: 'planner' },
      permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-plan',
      allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-plan',
      causationId: 'delivery-start',
      now: NOW,
    });
    const outcome: AgentOutcome = {
      outcomeId: 'outcome-plan',
      idempotencyKey: 'outcome-plan',
      contractId: contract.contractId,
      outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 0,
        tasks: [
          { id: 'task-build', title: 'Build', agentId: 'builder' },
          {
            id: 'task-review',
            title: 'Review',
            agentId: 'reviewer',
            dependencies: ['task-build'],
          },
        ],
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
    };
    expect(contracts.admitOutcome(outcome)).toMatchObject({ status: 'accepted' });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(1);
    expect(getDb().prepare(`
      SELECT project_agent_id,status,json_extract(command_json,'$.taskId') task_id
      FROM agent_inbox_item
    `).all()).toEqual([{
      project_agent_id: 'builder',
      status: 'enqueued',
      task_id: 'task-build',
    }]);
    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const manager = new TaskGraphOutcomeProcessManager();

    await manager.handle(event, { signal: new AbortController().signal });
    await manager.handle(event, { signal: new AbortController().signal });

    expect(taskGraphRepo.revision('project-task-graph')).toBe(1);
    expect(taskGraphRepo.getGraph('project-task-graph')).toMatchObject({
      tasks: [{ id: 'task-build' }, { id: 'task-review' }],
      edges: [{
        from_task_id: 'task-review',
        to_task_id: 'task-build',
        type: 'depends_on',
      }],
      actions: [{ type: 'task.split' }],
    });
    expect(getDb().prepare('SELECT COUNT(*) count FROM task_graph_commit').get())
      .toEqual({ count: 1 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 1 });

    taskRepo.transition('task-build', { to: 'in_progress' });
    taskRepo.transition('task-build', { to: 'in_review' });
    taskRepo.transition('task-build', { to: 'done' });
    const doneEvent = new PlatformEventLog({ db: getDb() })
      .listStream('task:task-build')
      .find((candidate) => candidate.type === 'task.done')!;
    const scheduler = new TaskGraphSchedulerProcessManager();
    await scheduler.handle(doneEvent, { signal: new AbortController().signal });
    await scheduler.handle(doneEvent, { signal: new AbortController().signal });
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id
      FROM agent_inbox_item ORDER BY created_at,id
    `).all()).toEqual([
      { project_agent_id: 'builder', task_id: 'task-build' },
      { project_agent_id: 'reviewer', task_id: 'task-review' },
    ]);
  });

  it('rejects a coordinator proposal that omits frozen unassigned work, then dispatches the corrected graph', () => {
    taskRepo.create({
      id: 'task-coordination-root',
      conversation_id: 'project-task-graph',
      title: 'Coordinate this goal',
      agent_id: '',
      initialStatus: 'proposed',
    }, NOW);
    taskRepo.create({
      id: 'task-coordination-dependent',
      conversation_id: 'project-task-graph',
      title: 'Integrate after the root',
      agent_id: '',
      dependencies: ['task-coordination-root'],
      initialStatus: 'proposed',
    }, NOW);
    const revision = taskGraphRepo.revision('project-task-graph');
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:coordination-root',
      attemptId: 'inv-coordination-root',
      projectId: 'project-task-graph',
      agentId: 'planner',
      goal: 'Decompose and coordinate the goal',
      acceptanceCriteria: ['Cover the frozen root Task'],
      role: { responsibility: 'coordinator' },
      permissions: {
        coordination: {
          mode: 'task_graph_first',
          requiredTaskIds: ['task-coordination-root', 'task-coordination-dependent'],
        },
      },
      authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: { taskGraph: revision },
      contextSnapshotRef: 'context-coordination-root',
      allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-coordination-root',
      causationId: 'request-coordination-root',
      now: NOW,
    });
    const outcome = (input: {
      id: string;
      tasks: Array<{ id: string; title: string; agentId: string; dependencies?: string[] }>;
    }): AgentOutcome => ({
      outcomeId: input.id,
      idempotencyKey: input.id,
      contractId: contract.contractId,
      outcomeType: 'propose_task_graph',
      payload: { expectedRevision: revision, tasks: input.tasks },
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

    expect(contracts.admitOutcome(outcome({
      id: 'outcome-coordination-missing-root',
      tasks: [{ id: 'task-unrelated', title: 'Unrelated', agentId: 'builder' }],
    }))).toMatchObject({
      status: 'rejected',
      outcome: { rejection_reason: 'task_graph_coordination_tasks_missing' },
    });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(revision);
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get())
      .toEqual({ count: 0 });

    expect(contracts.admitOutcome(outcome({
      id: 'outcome-coordination-corrected',
      tasks: [
        { id: 'task-coordination-root', title: 'Coordinate this goal', agentId: 'builder' },
        {
          id: 'task-coordination-dependent', title: 'Integrate after the root', agentId: 'reviewer',
          dependencies: ['task-coordination-root'],
        },
      ],
    }))).toMatchObject({ status: 'accepted' });
    expect(taskRepo.getById('task-coordination-root')).toMatchObject({
      agent_id: 'builder',
      status: 'ready',
    });
    expect(taskRepo.getById('task-coordination-dependent')).toMatchObject({
      agent_id: 'reviewer',
      status: 'ready',
    });
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id
      FROM agent_inbox_item
    `).all()).toEqual([{ project_agent_id: 'builder', task_id: 'task-coordination-root' }]);
  });

  it('turns verify intent into one revision-fenced QualityGate command', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:verify', attemptId: 'inv-verify', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan verification', acceptanceCriteria: ['Create a verification gate'],
      role: {}, permissions: {}, authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: { taskGraph: 0 }, contextSnapshotRef: 'context-verify',
      allowedOutcomeTypes: ['propose_task_graph'], correlationId: 'trace-verify',
      causationId: 'request-verify', now: NOW,
    });
    const outcome: AgentOutcome = {
      outcomeId: 'outcome-verify', idempotencyKey: 'outcome-verify',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 0,
        tasks: [{
          id: 'task-verify', title: 'Verify the implementation', agentId: 'reviewer',
          intent: 'verify', description: 'Run E2E and record the gate decision.',
        }],
      },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    };

    expect(contracts.admitOutcome(outcome)).toMatchObject({ status: 'accepted' });
    const task = taskRepo.getById('task-verify');
    expect(task).toMatchObject({ intent: 'verify', status: 'in_review', agent_id: 'reviewer' });
    const gate = getDb().prepare(`
      SELECT id,kind,target_type,target_id,artifact_revision,status FROM quality_gate
      WHERE target_id='task-verify'
    `).get() as Record<string, unknown>;
    expect(gate).toMatchObject({
      kind: 'code_review', target_type: 'task', target_id: 'task-verify',
      artifact_revision: String(task!.revision), status: 'requested',
    });
    expect(getDb().prepare(`
      SELECT project_agent_id,
        json_extract(command_json,'$.source') source,
        json_extract(command_json,'$.taskId') task_id,
        json_extract(command_json,'$.replyTo.type') reply_type,
        json_extract(command_json,'$.replyTo.id') reply_id,
        json_extract(command_json,'$.contextScenario') scenario
      FROM agent_inbox_item
    `).get()).toEqual({
      project_agent_id: 'reviewer', source: 'test_gate', task_id: 'task-verify',
      reply_type: 'quality_gate', reply_id: gate.id, scenario: 'verification',
    });

    const event = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${contract.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    const manager = new TaskGraphOutcomeProcessManager();
    await manager.handle(event, { signal: new AbortController().signal });
    expect(getDb().prepare('SELECT COUNT(*) count FROM quality_gate').get()).toEqual({ count: 1 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 1 });
  });

  it('replays a v1 event-id commit without a second graph mutation', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:legacy', attemptId: 'inv-legacy', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Legacy plan', acceptanceCriteria: ['Recover dispatch'],
      role: {}, permissions: {}, authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: {}, contextSnapshotRef: 'context-legacy',
      allowedOutcomeTypes: ['propose_task_graph'], correlationId: 'trace-legacy',
      causationId: 'request-legacy', now: NOW,
    });
    const payload = {
      expectedRevision: 0,
      tasks: [
        { id: 'task-legacy', title: 'Legacy task', agentId: 'builder' },
        {
          id: 'task-legacy-dependent', title: 'Legacy dependent', agentId: 'reviewer',
          dependencies: ['task-legacy'],
        },
      ],
    };
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,
        fencing_token,outcome_type,payload_json,evidence_refs_json,
        authoritative_revisions_json,correlation_id,causation_id,occurred_at,
        admission_status,rejection_reason,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-legacy', 'outcome-legacy', contract.contractId, contract.projectId,
      contract.workId, contract.workEpoch, contract.attemptId, contract.fencingToken,
      'propose_task_graph', JSON.stringify(payload), '[]',
      JSON.stringify(contract.authoritativeRevisions), contract.correlationId,
      contract.contractId, NOW.toISOString(), 'accepted', null, NOW.toISOString(),
    );
    const event = new PlatformEventLog({ db: getDb() }).append({
      type: 'agent.outcome.accepted', category: 'coordination', projectId: contract.projectId,
      streamKey: `work:${contract.workId}`,
      aggregate: { type: 'agent_outcome', id: 'outcome-legacy' },
      actor: { type: 'agent', id: 'planner' }, correlationId: contract.correlationId,
      causationId: contract.contractId, occurredAt: NOW.toISOString(),
      payload: { contractId: contract.contractId, workEpoch: contract.workEpoch, outcomeType: 'propose_task_graph' },
    });
    taskGraphRepo.commit({
      conversationId: contract.projectId, expectedRevision: 0,
      idempotencyKey: event.eventId, actorId: contract.agentId, actorType: 'agent',
      correlationId: event.correlationId, causationId: event.eventId,
      tasks: [
        { id: 'task-legacy', title: 'Legacy task', agent_id: 'builder' },
        {
          id: 'task-legacy-dependent', title: 'Legacy dependent', agent_id: 'reviewer',
          dependencies: ['task-legacy'],
        },
      ],
      now: NOW,
    });
    getDb().prepare(`
      UPDATE task_graph_commit SET result_json='{}' WHERE idempotency_key=?
    `).run(event.eventId);
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 0 });

    const manager = new TaskGraphOutcomeProcessManager();
    await manager.handle(event, { signal: new AbortController().signal });
    await manager.handle(event, { signal: new AbortController().signal });

    expect(taskGraphRepo.revision(contract.projectId)).toBe(1);
    expect(getDb().prepare('SELECT COUNT(*) count FROM task_graph_commit').get()).toEqual({ count: 1 });
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id FROM agent_inbox_item
    `).get()).toEqual({ project_agent_id: 'builder', task_id: 'task-legacy' });

    taskRepo.transition('task-legacy', { to: 'in_progress' });
    taskRepo.transition('task-legacy', { to: 'in_review' });
    taskRepo.transition('task-legacy', { to: 'done' });
    const doneEvent = new PlatformEventLog({ db: getDb() })
      .listStream('task:task-legacy')
      .find((candidate) => candidate.type === 'task.done')!;
    await new TaskGraphSchedulerProcessManager().handle(
      doneEvent,
      { signal: new AbortController().signal },
    );
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id
      FROM agent_inbox_item ORDER BY created_at,id
    `).all()).toEqual([
      { project_agent_id: 'builder', task_id: 'task-legacy' },
      { project_agent_id: 'reviewer', task_id: 'task-legacy-dependent' },
    ]);
  });

  it('recovers an old accepted proposal that predates frozen graph authority', async () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:legacy-uncommitted', attemptId: 'inv-legacy-uncommitted',
      projectId: 'project-task-graph', agentId: 'planner', goal: 'Recover old plan',
      acceptanceCriteria: ['Commit once'], role: {}, permissions: {},
      authoritativeRefs: ['context_snapshot:context-legacy-uncommitted'],
      authoritativeRevisions: {}, contextSnapshotRef: 'context-legacy-uncommitted',
      allowedOutcomeTypes: ['propose_task_graph'], correlationId: 'trace-legacy-uncommitted',
      causationId: 'request-legacy-uncommitted', now: NOW,
    });
    const payload = {
      expectedRevision: 0,
      tasks: [{ id: 'task-legacy-uncommitted', title: 'Recovered old task', agentId: 'builder' }],
    };
    getDb().prepare(`
      INSERT INTO agent_outcome (
        id,idempotency_key,contract_id,project_id,work_id,work_epoch,attempt_id,
        fencing_token,outcome_type,payload_json,evidence_refs_json,
        authoritative_revisions_json,correlation_id,causation_id,occurred_at,
        admission_status,rejection_reason,recorded_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'outcome-legacy-uncommitted', 'outcome-legacy-uncommitted', contract.contractId,
      contract.projectId, contract.workId, contract.workEpoch, contract.attemptId,
      contract.fencingToken, 'propose_task_graph', JSON.stringify(payload), '[]', '{}',
      contract.correlationId, contract.contractId, NOW.toISOString(), 'accepted', null,
      NOW.toISOString(),
    );
    const event = new PlatformEventLog({ db: getDb() }).append({
      type: 'agent.outcome.accepted', category: 'coordination', projectId: contract.projectId,
      streamKey: `work:${contract.workId}`,
      aggregate: { type: 'agent_outcome', id: 'outcome-legacy-uncommitted' },
      actor: { type: 'agent', id: 'planner' }, correlationId: contract.correlationId,
      causationId: contract.contractId, occurredAt: NOW.toISOString(),
      payload: { contractId: contract.contractId, workEpoch: contract.workEpoch, outcomeType: 'propose_task_graph' },
    });

    await new TaskGraphOutcomeProcessManager().handle(
      event,
      { signal: new AbortController().signal },
    );

    expect(taskGraphRepo.revision(contract.projectId)).toBe(1);
    expect(taskRepo.getById('task-legacy-uncommitted')).toMatchObject({
      agent_id: 'builder', status: 'ready',
    });
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id FROM agent_inbox_item
    `).get()).toEqual({ project_agent_id: 'builder', task_id: 'task-legacy-uncommitted' });
  });

  it('rejects malformed proposals before consuming the exit or changing Task authority', () => {
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:malformed', attemptId: 'inv-malformed', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan', acceptanceCriteria: ['Submit a valid graph'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-malformed', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-malformed', causationId: 'request-malformed', now: NOW,
    });
    const candidate: AgentOutcome = {
      outcomeId: 'outcome-malformed', idempotencyKey: 'outcome-malformed',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: { nodes: [{ id: 'task-wrong-shape', assignee: 'builder' }] }, evidenceRefs: [],
      projectId: contract.projectId, workId: contract.workId, workEpoch: contract.workEpoch,
      attemptId: contract.attemptId, fencingToken: contract.fencingToken,
      authoritativeRevisions: contract.authoritativeRevisions, correlationId: contract.correlationId,
      causationId: contract.contractId, occurredAt: NOW.toISOString(),
    };

    expect(contracts.admitOutcome(candidate)).toMatchObject({
      status: 'rejected',
      reasonCode: 'task_graph_expected_revision_required',
    });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(0);
    expect(getDb().prepare('SELECT COUNT(*) count FROM task_graph_commit').get()).toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM task').get()).toEqual({ count: 0 });
    expect(getDb().prepare('SELECT COUNT(*) count FROM agent_inbox_item').get()).toEqual({ count: 0 });
  });

  it('assigns an existing ready WorkItem without changing its identity', () => {
    taskRepo.create({
      id: 'work-existing', conversation_id: 'project-task-graph', title: 'Existing work', agent_id: '',
    });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:existing', attemptId: 'inv-existing', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Assign existing work', acceptanceCriteria: ['Assign the WorkItem'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-existing', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-existing', causationId: 'request-existing', now: NOW,
    });
    const result = contracts.admitOutcome({
      outcomeId: 'outcome-existing', idempotencyKey: 'outcome-existing',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 0,
        tasks: [{ id: 'work-existing', title: 'Existing work', agentId: 'builder' }],
      },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    });

    expect(result).toMatchObject({ status: 'accepted' });
    expect(taskRepo.getById('work-existing')).toMatchObject({
      id: 'work-existing', agent_id: 'builder', status: 'ready', revision: 1,
    });
    expect(taskGraphRepo.getGraph('project-task-graph').actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'task.planned' }),
    ]));
    expect(getDb().prepare(`
      SELECT project_agent_id,json_extract(command_json,'$.taskId') task_id FROM agent_inbox_item
    `).get()).toEqual({ project_agent_id: 'builder', task_id: 'work-existing' });
  });

  it('rejects an assignee outside the project before recording acceptance', () => {
    getDb().prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('outsider','Outsider','role','default','🤖',?,?)
    `).run(NOW.toISOString(), NOW.toISOString());
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:outsider', attemptId: 'inv-outsider', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan', acceptanceCriteria: ['Use project members'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-outsider', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-outsider', causationId: 'request-outsider', now: NOW,
    });

    expect(contracts.admitOutcome({
      outcomeId: 'outcome-outsider', idempotencyKey: 'outcome-outsider',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: { expectedRevision: 0, tasks: [{ id: 'task-outsider', title: 'Outside', agentId: 'outsider' }] },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'rejected', reasonCode: 'task_graph_agent_not_in_project' });
    expect(getDb().prepare(`
      SELECT COUNT(*) count FROM agent_outcome WHERE admission_status='accepted'
    `).get()).toEqual({ count: 0 });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(0);
  });

  it('rejects stale graph authority and leaves the accepted outcome slot unused', () => {
    taskGraphRepo.commit({
      conversationId: 'project-task-graph', expectedRevision: 0, actorId: 'system', actorType: 'system',
      idempotencyKey: 'seed-graph', tasks: [{ id: 'seed-task', title: 'Seed', agent_id: 'builder' }],
    });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:stale', attemptId: 'inv-stale', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan', acceptanceCriteria: ['Use current authority'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-stale', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-stale', causationId: 'request-stale', now: NOW,
    });

    expect(contracts.admitOutcome({
      outcomeId: 'outcome-stale', idempotencyKey: 'outcome-stale',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: { expectedRevision: 0, tasks: [{ id: 'task-stale', title: 'Stale', agentId: 'builder' }] },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'rejected', reasonCode: 'stale_task_graph_revision' });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(1);
    expect(taskRepo.getById('task-stale')).toBeUndefined();
  });

  it('cannot replace a frozen contract revision with a newer payload revision', () => {
    taskGraphRepo.commit({
      conversationId: 'project-task-graph', expectedRevision: 0, actorId: 'system', actorType: 'system',
      idempotencyKey: 'advance-before-outcome',
      tasks: [{ id: 'task-before-outcome', title: 'Existing graph', agent_id: 'builder' }],
    });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:frozen', attemptId: 'inv-frozen', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan', acceptanceCriteria: ['Respect frozen authority'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-frozen', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-frozen', causationId: 'request-frozen', now: NOW,
    });

    expect(contracts.admitOutcome({
      outcomeId: 'outcome-frozen', idempotencyKey: 'outcome-frozen',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: { expectedRevision: 1, tasks: [{ id: 'task-exploit', title: 'Exploit', agentId: 'builder' }] },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'rejected', reasonCode: 'task_graph_authority_mismatch' });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(1);
    expect(taskRepo.getById('task-exploit')).toBeUndefined();
  });

  it('does not let planning rewrite a WorkItem that is already executing', () => {
    taskRepo.create({
      id: 'work-running', conversation_id: 'project-task-graph', title: 'Running work', agent_id: 'builder',
    });
    taskRepo.transition('work-running', { to: 'in_progress' });
    const contracts = new WorkContractRepository();
    const contract = contracts.issue({
      workId: 'planning:running', attemptId: 'inv-running', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan', acceptanceCriteria: ['Preserve active work'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph'], authoritativeRevisions: { taskGraph: 0 },
      contextSnapshotRef: 'context-running', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-running', causationId: 'request-running', now: NOW,
    });

    expect(contracts.admitOutcome({
      outcomeId: 'outcome-running', idempotencyKey: 'outcome-running',
      contractId: contract.contractId, outcomeType: 'propose_task_graph',
      payload: { expectedRevision: 0, tasks: [{ id: 'work-running', title: 'Rewritten', agentId: 'builder' }] },
      evidenceRefs: [], projectId: contract.projectId, workId: contract.workId,
      workEpoch: contract.workEpoch, attemptId: contract.attemptId,
      fencingToken: contract.fencingToken, authoritativeRevisions: contract.authoritativeRevisions,
      correlationId: contract.correlationId, causationId: contract.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'rejected', reasonCode: 'invalid_task_graph' });
    expect(taskRepo.getById('work-running')).toMatchObject({ title: 'Running work', status: 'in_progress' });
    expect(taskGraphRepo.revision('project-task-graph')).toBe(0);
  });

  it('does not wake a Task whose latest proposal moved under Delivery control', async () => {
    const contracts = new WorkContractRepository();
    const standalone = contracts.issue({
      workId: 'planning:ownership', attemptId: 'inv-ownership-1', projectId: 'project-task-graph',
      agentId: 'planner', goal: 'Plan standalone', acceptanceCriteria: ['Create dependencies'],
      role: {}, permissions: {}, authoritativeRefs: ['task_graph:project-task-graph'],
      authoritativeRevisions: { taskGraph: 0 }, contextSnapshotRef: 'context-ownership-1',
      allowedOutcomeTypes: ['propose_task_graph'], correlationId: 'trace-ownership',
      causationId: 'request-ownership-1', now: NOW,
    });
    expect(contracts.admitOutcome({
      outcomeId: 'outcome-ownership-1', idempotencyKey: 'outcome-ownership-1',
      contractId: standalone.contractId, outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 0,
        tasks: [
          { id: 'task-prerequisite', title: 'Prerequisite', agentId: 'builder' },
          { id: 'task-delivery-owned', title: 'Delivery owned', agentId: 'reviewer', dependencies: ['task-prerequisite'] },
        ],
      },
      evidenceRefs: [], projectId: standalone.projectId, workId: standalone.workId,
      workEpoch: standalone.workEpoch, attemptId: standalone.attemptId,
      fencingToken: standalone.fencingToken, authoritativeRevisions: standalone.authoritativeRevisions,
      correlationId: standalone.correlationId, causationId: standalone.contractId,
      occurredAt: NOW.toISOString(),
    })).toMatchObject({ status: 'accepted' });
    const runId = new AutonomousDeliveryRepository().createRun({
      idempotencyKey: 'delivery-ownership', goal: 'Own the dependent task',
      acceptanceCriteria: ['Finish under Delivery'], scope: { conversationId: 'project-task-graph' },
      authorization: {
        allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false,
      },
      recoveryPolicy: { maxAttemptsPerAction: 1, maxRepairCycles: 0, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: false, requireWebE2E: false, requireMerge: false },
    }, new Date(NOW.getTime() + 1)).run.id;
    const delivery = contracts.issue({
      workId: 'planning:ownership:delivery', attemptId: 'inv-ownership-2',
      projectId: 'project-task-graph', deliveryRunId: runId, agentId: 'planner',
      goal: 'Plan Delivery', acceptanceCriteria: ['Take graph ownership'], role: {}, permissions: {},
      authoritativeRefs: ['task_graph:project-task-graph', `delivery_run:${runId}`],
      authoritativeRevisions: { taskGraph: 1, deliveryRun: 0 },
      contextSnapshotRef: 'context-ownership-2', allowedOutcomeTypes: ['propose_task_graph'],
      correlationId: 'trace-ownership', causationId: 'request-ownership-2',
      now: new Date(NOW.getTime() + 2),
    });
    expect(contracts.admitOutcome({
      outcomeId: 'outcome-ownership-2', idempotencyKey: 'outcome-ownership-2',
      contractId: delivery.contractId, outcomeType: 'propose_task_graph',
      payload: {
        expectedRevision: 1,
        tasks: [{
          id: 'task-delivery-owned', title: 'Delivery owned', agentId: 'reviewer',
          dependencies: ['task-prerequisite'],
        }],
      },
      evidenceRefs: [], projectId: delivery.projectId, workId: delivery.workId,
      workEpoch: delivery.workEpoch, attemptId: delivery.attemptId,
      fencingToken: delivery.fencingToken, authoritativeRevisions: delivery.authoritativeRevisions,
      correlationId: delivery.correlationId, causationId: delivery.contractId,
      occurredAt: new Date(NOW.getTime() + 2).toISOString(),
    })).toMatchObject({ status: 'accepted' });

    taskRepo.transition('task-prerequisite', { to: 'in_progress' });
    taskRepo.transition('task-prerequisite', { to: 'in_review' });
    taskRepo.transition('task-prerequisite', { to: 'done' });
    const doneEvent = new PlatformEventLog({ db: getDb() })
      .listStream('task:task-prerequisite')
      .find((candidate) => candidate.type === 'task.done')!;
    await new TaskGraphSchedulerProcessManager().handle(
      doneEvent,
      { signal: new AbortController().signal },
    );
    const delayedStandaloneEvent = new PlatformEventLog({ db: getDb() })
      .listStream(`work:${standalone.workId}`)
      .find((candidate) => candidate.type === 'agent.outcome.accepted')!;
    await new TaskGraphOutcomeProcessManager().handle(
      delayedStandaloneEvent,
      { signal: new AbortController().signal },
    );

    expect(getDb().prepare(`
      SELECT COUNT(*) count FROM agent_inbox_item
      WHERE json_extract(command_json,'$.taskId')='task-delivery-owned'
    `).get()).toEqual({ count: 0 });
  });
});
