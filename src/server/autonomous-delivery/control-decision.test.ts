import { describe, expect, it } from 'vitest';
import {
  decideControlActions,
  type DeliveryControlPolicy,
  type DeliveryControlSnapshot,
  type WorkCellControlSnapshot,
} from './control-decision';

const NOW = '2026-07-28T12:00:00.000Z';
const POLICY: DeliveryControlPolicy = {
  revision: 4,
  maxConcurrent: 2,
  roleCapacity: { builder: 1, reviewer: 1 },
  fairnessAgingMs: 60_000,
};

function cell(
  workId: string,
  state: WorkCellControlSnapshot['state'],
  overrides: Partial<WorkCellControlSnapshot> = {},
): WorkCellControlSnapshot {
  return {
    workId,
    workEpoch: 1,
    roleId: 'builder',
    state,
    priority: 10,
    queuedAt: '2026-07-28T11:59:00.000Z',
    ...overrides,
  };
}

function snapshot(workCells: WorkCellControlSnapshot[]): DeliveryControlSnapshot {
  return {
    runId: 'delivery-1',
    snapshotRevision: 7,
    observedAt: NOW,
    workCells,
    waitForEdges: [],
    closure: { satisfied: false },
  };
}

describe('decideControlActions', () => {
  it('is deterministic for the same fact and policy revisions', () => {
    const facts = snapshot([cell('work-1', 'ready')]);

    expect(decideControlActions(facts, POLICY))
      .toEqual(decideControlActions(facts, POLICY));
  });

  it('initializes a missing Task Graph without reserving an Agent slot', () => {
    const decision = decideControlActions(snapshot([
      cell('delivery:delivery-1:purpose:initialize-task-graph', 'ready', {
        workEpoch: 0,
        roleId: 'delivery-planning',
        purpose: 'planning',
      }),
    ]), { ...POLICY, maxConcurrent: 0 });

    expect(decision.actions).toMatchObject([{
      type: 'initializeGraph',
      reasonCode: 'delivery_task_graph_missing',
    }]);
    expect(decision.actions[0]?.slotId).toBeUndefined();
  });

  it('schedules provider integration only after work and delivery gates are complete', () => {
    const facts = snapshot([cell('work-1', 'completed')]);
    facts.closure.integration = {
      required: true,
      gatesSatisfied: true,
      merged: false,
      effectScheduled: false,
    };

    expect(decideControlActions(facts, POLICY).actions).toMatchObject([{
      type: 'integrate',
      reasonCode: 'provider_integration_required',
    }]);

    facts.closure.integration.gatesSatisfied = false;
    expect(decideControlActions(facts, POLICY).actions).toEqual([]);
  });

  it('waits for one running cell while activating another within remaining capacity', () => {
    const decision = decideControlActions(snapshot([
      cell('running-builder', 'running', { slotId: 'builder:1' }),
      cell('ready-review', 'ready', { roleId: 'reviewer' }),
    ]), POLICY);

    expect(decision.actions).toMatchObject([
      {
        type: 'activate',
        targetWorkId: 'ready-review',
        slotId: 'reviewer:1',
      },
      {
        type: 'wait',
        targetWorkId: 'running-builder',
        reasonCode: 'invocation_running',
      },
    ]);
  });

  it('applies role capacity independently from global capacity', () => {
    const decision = decideControlActions(snapshot([
      cell('running-builder', 'running', { slotId: 'builder:1' }),
      cell('second-builder', 'ready'),
    ]), { ...POLICY, maxConcurrent: 3 });

    expect(decision.actions.find((action) => action.targetWorkId === 'second-builder'))
      .toMatchObject({ type: 'wait', reasonCode: 'role_capacity_exhausted' });
  });

  it('keeps retry budgets separate by failure class', () => {
    const decision = decideControlActions(snapshot([
      cell('invocation-retry', 'retry_pending', {
        failure: {
          reasonCode: 'runtime_transport_lost',
          retryable: true,
          humanRecoverable: true,
          budget: { kind: 'invocation', attemptsUsed: 1, maxAttempts: 2 },
        },
      }),
      cell('effect-exhausted', 'retry_pending', {
        roleId: 'reviewer',
        failure: {
          reasonCode: 'provider_permission_missing',
          retryable: true,
          humanRecoverable: true,
          budget: { kind: 'effect', attemptsUsed: 3, maxAttempts: 3 },
        },
      }),
    ]), POLICY);

    expect(decision.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'retry',
        targetWorkId: 'invocation-retry',
        retryBudgetKind: 'invocation',
      }),
      expect.objectContaining({
        type: 'escalateToHuman',
        targetWorkId: 'effect-exhausted',
      }),
    ]));
  });

  it('requests gates, resumes resolved human work and terminates only on closure', () => {
    const active = decideControlActions(snapshot([
      cell('artifact', 'artifact_submitted'),
      cell('human', 'waiting_human', {
        roleId: 'reviewer',
        humanResolution: 'resolved',
      }),
    ]), POLICY);
    expect(active.actions.map((action) => action.type)).toEqual(['resume', 'requestGate']);

    const completeFacts = snapshot([
      cell('artifact', 'completed'),
      cell('human', 'completed', { roleId: 'reviewer' }),
    ]);
    completeFacts.closure.satisfied = true;
    expect(decideControlActions(completeFacts, POLICY).actions)
      .toMatchObject([{ type: 'terminate', terminationOutcome: 'completed' }]);
  });

  it('finalizes a ready delivery before a later decision can terminate it', () => {
    const facts = snapshot([cell('work-1', 'completed')]);
    facts.closure.finalizationReady = true;

    expect(decideControlActions(facts, POLICY).actions)
      .toMatchObject([{ type: 'finalize', reasonCode: 'delivery_bundle_ready' }]);

    facts.closure.finalizationReady = false;
    facts.closure.satisfied = true;
    expect(decideControlActions(facts, POLICY).actions)
      .toMatchObject([{ type: 'terminate', terminationOutcome: 'completed' }]);
  });

  it('uses explicit snapshot time for starvation-safe deterministic ordering', () => {
    const decision = decideControlActions(snapshot([
      cell('new-high', 'ready', {
        roleId: 'reviewer',
        priority: 10,
        queuedAt: '2026-07-28T11:59:30.000Z',
      }),
      cell('old-low', 'ready', {
        priority: 8,
        queuedAt: '2026-07-28T11:54:00.000Z',
      }),
    ]), { ...POLICY, maxConcurrent: 1, roleCapacity: { builder: 1, reviewer: 1 } });

    expect(decision.actions[0]).toMatchObject({
      type: 'activate',
      targetWorkId: 'old-low',
    });
  });

  it('short-circuits unsafe closure with one failed termination command', () => {
    const facts = snapshot([cell('work-1', 'ready')]);
    facts.closure.unrecoverableReasonCode = 'policy_revoked';

    expect(decideControlActions(facts, POLICY).actions).toMatchObject([{
      type: 'terminate',
      reasonCode: 'policy_revoked',
      terminationOutcome: 'failed',
    }]);
  });

  it('waits for an applicable blocking Effect and escalates its dead letter', () => {
    const facts = snapshot([cell('work-1', 'completed')]);
    facts.closure.blockingEffect = {
      effectId: 'effect-1',
      status: 'pending',
      attemptsUsed: 1,
      maxAttempts: 3,
    };
    expect(decideControlActions(facts, POLICY).actions).toMatchObject([{
      type: 'wait',
      reasonCode: 'blocking_effect_pending:effect-1',
      retryBudgetKind: 'effect',
    }]);

    facts.closure.blockingEffect.status = 'dead_letter';
    facts.closure.blockingEffect.attemptsUsed = 3;
    expect(decideControlActions(facts, POLICY).actions).toMatchObject([{
      type: 'escalateToHuman',
      reasonCode: 'blocking_effect_dead_letter:effect-1',
      retryBudgetKind: 'effect',
    }]);
  });

  it('escalates a cross-Work-Cell wait-for deadlock without retrying an Agent', () => {
    const facts = snapshot([
      cell('work-a', 'waiting_dependency'),
      cell('work-b', 'waiting_dependency'),
    ]);
    facts.closure.deadlock = {
      cycle: ['work-a', 'work-b', 'work-a'],
      reasonCode: 'wait_for_deadlock:work-a->work-b->work-a',
    };

    expect(decideControlActions(facts, POLICY).actions).toMatchObject([{
      type: 'escalateToHuman',
      reasonCode: 'wait_for_deadlock:work-a->work-b->work-a',
    }]);
  });
});
