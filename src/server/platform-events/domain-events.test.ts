import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { taskRepo } from '../repositories/task-repo';
import { AutonomousDeliveryRepository } from '../autonomous-delivery/repository';
import type { GoalContract } from '../autonomous-delivery/types';
import { ChainRepo } from '../a2a/chain';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { sessionRepo } from '../repositories/session-repo';
import { runtimeNodeRepo } from '../repositories/runtime-node-repo';
import { agentBindingRepo } from '../repositories/agent-binding-repo';
import {
  DOMAIN_EVENT_TYPES_BY_OWNER,
  type DomainEventType,
} from './domain-events';
import { PlatformEventLog } from './event-log';

describe('domain event inline seam', () => {
  let db: Database.Database;
  let log: PlatformEventLog;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-25T03:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({ db });
  });

  afterEach(() => {
    resetDb();
  });

  it('keeps the complete catalog assigned to exactly nine domain owners', () => {
    expect(Object.keys(DOMAIN_EVENT_TYPES_BY_OWNER)).toEqual([
      'task', 'review', 'delivery', 'a2a', 'envelope',
      'binding', 'node', 'invocation', 'session',
    ]);
    const types = Object.values(DOMAIN_EVENT_TYPES_BY_OWNER).flat();
    expect(new Set(types).size).toBe(types.length);
    expect(types).toContain('task.assigned' satisfies DomainEventType);
    expect(types).toContain('session.sealed' satisfies DomainEventType);
  });

  it('publishes task state changes inline and skips no-op updates', () => {
    taskRepo.create({
      id: 'task-1',
      conversation_id: 'project-1',
      title: 'Task',
      agent_id: 'implementer',
    });
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'in_progress' });
    taskRepo.transition('task-1', { to: 'blocked', reviewNote: 'Dependency missing' });

    expect(log.listStream('task:task-1').map((event) => event.type)).toEqual([
      'task.assigned',
      'task.in_progress',
      'task.blocked',
    ]);
  });

  it('rolls back the domain row when inline event append conflicts', () => {
    log.append({
      type: 'task.assigned',
      category: 'domain',
      projectId: 'project-1',
      streamKey: 'task:other',
      aggregate: { type: 'task', id: 'other' },
      actor: { type: 'system', id: 'test' },
      correlationId: 'other',
      dedupeKey: 'task:task-conflict:created:assigned',
      payload: { agentId: 'other', status: 'ready' },
    });

    expect(() => taskRepo.create({
      id: 'task-conflict',
      conversation_id: 'project-1',
      title: 'Must roll back',
      agent_id: 'implementer',
    })).toThrow();
    expect(taskRepo.getById('task-conflict')).toBeUndefined();
  });

  it('does not revise or emit when a delivery run update changes no facts', () => {
    const repository = new AutonomousDeliveryRepository();
    const contract: GoalContract = {
      goal: 'Ship it',
      acceptanceCriteria: ['It works'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 1,
        maxRepairCycles: 0,
        stallTimeoutMs: 1_000,
      },
      deliveryPolicy: {
        requireReview: false,
        requireWebE2E: false,
        requireMerge: false,
      },
    };
    const created = repository.createRun(contract);

    const unchanged = repository.updateRun({
      runId: created.run.id,
      status: created.run.status,
      stage: created.run.current_stage,
      expectedRevision: created.run.revision,
    });

    expect(unchanged?.revision).toBe(created.run.revision);
    expect(log.listStream(`delivery_run:${created.run.id}`).map((event) => event.type))
      .toEqual(['delivery.run.submitted']);
  });

  it('keeps A2A terminal states final and emits bulk abort facts inline', () => {
    const chains = new ChainRepo(db);
    const first = chains.create({
      conversationId: 'project-1',
      type: 'user_message',
      messageId: 'message-1',
    });
    const entry = chains.appendWorklist(first.id, 'agent-a', 'user', 'Do work', 'hash-1', 0)!;
    const second = chains.create({
      conversationId: 'project-1',
      type: 'user_message',
      messageId: 'message-2',
    });

    expect(chains.abortAllActive('project-1')).toBe(2);
    chains.complete(first.id);
    chains.markDone(entry.id, 'success');

    expect(chains.getById(first.id)?.status).toBe('aborted');
    expect(chains.getWorklistForChain(first.id)[0]?.status).toBe('aborted');
    expect(log.listStream(`a2a_chain:${first.id}`).map((event) => event.type))
      .toEqual(['a2a.chain.aborted']);
    expect(log.listStream(`a2a_chain:${second.id}`).map((event) => event.type))
      .toEqual(['a2a.chain.aborted']);
  });

  it('keeps envelope terminal states final and emits blocked as a domain fact', () => {
    const envelope = executionEnvelopeRepo.create({
      source: 'workflow',
      intent: 'implement',
      conversationId: 'project-1',
      fromNodeId: 'node-a',
      toNodeId: 'node-b',
      toAgentId: 'implementer',
    });
    executionEnvelopeRepo.updateStatus(envelope.id, 'blocked', 'node_missing');
    executionEnvelopeRepo.updateStatus(envelope.id, 'completed');
    executionEnvelopeRepo.updateStatus(envelope.id, 'failed', 'late_failure');

    expect(executionEnvelopeRepo.getById(envelope.id)).toMatchObject({
      status: 'blocked',
      reason_code: 'node_missing',
    });
    expect(log.listStream(`envelope:${envelope.id}`).map((event) => event.type))
      .toEqual(['envelope.blocked']);
  });

  it('does not claim an empty task owner as an assignment fact', () => {
    taskRepo.create({
      id: 'task-unassigned',
      conversation_id: 'project-1',
      title: 'Needs owner',
      agent_id: '',
    });

    expect(log.listStream('task:task-unassigned')).toHaveLength(0);
  });

  it('publishes invocation and session transitions from their owner transactions', () => {
    invocationRepo.create({
      id: 'invocation-1',
      conversation_id: 'project-1',
      agent_id: 'implementer',
      prompt: 'Work',
    });
    invocationRepo.updateStatus('invocation-1', 'running');
    invocationRepo.updateStatus('invocation-1', 'succeeded', { exit_code: 0 });
    invocationRepo.updateStatus('invocation-1', 'running');
    invocationRepo.updateStatus('invocation-1', 'failed', { reason_code: 'late_failure' });
    sessionRepo.create({
      id: 'session-1',
      conversationId: 'project-1',
      agentId: 'implementer',
      taskId: 'task-1',
    });
    sessionRepo.seal('session-1', 'completed');
    sessionRepo.seal('session-1', 'late_duplicate');

    expect(log.listStream('domain-invocation:invocation-1').map((event) => event.type)).toEqual([
      'invocation.queued',
      'invocation.claimed',
      'invocation.succeeded',
    ]);
    expect(invocationRepo.getById('invocation-1')?.status).toBe('succeeded');
    invocationRepo.create({
      id: 'invocation-retry',
      conversation_id: 'project-1',
      agent_id: 'implementer',
    });
    invocationRepo.updateStatus('invocation-retry', 'failed', { reason_code: 'attempt_failed' });
    invocationRepo.updateStatus('invocation-retry', 'succeeded');
    expect(invocationRepo.getById('invocation-retry')?.status).toBe('failed');
    invocationRepo.updateStatus('invocation-retry', 'running');
    expect(log.listStream('domain-invocation:invocation-retry').map((event) => event.type)).toEqual([
      'invocation.queued',
      'invocation.failed',
      'invocation.claimed',
    ]);
    expect(log.listStream('session:session-1').map((event) => event.type))
      .toEqual(['session.sealed']);
  });

  it('publishes binding and node state changes without duplicate no-op facts', () => {
    runtimeNodeRepo.register({ id: 'node-1', kind: 'daemon', label: 'Node' });
    agentBindingRepo.upsert({
      conversationId: 'project-1',
      agentId: 'implementer',
      nodeId: 'node-1',
      runtimeId: 'runtime-1',
    });
    const binding = agentBindingRepo.get('project-1', 'implementer')!;
    agentBindingRepo.markStarted('project-1', 'implementer', 'envelope-1');
    agentBindingRepo.markStarted('project-1', 'implementer', 'envelope-1');
    agentBindingRepo.markFinished('project-1', 'implementer');
    runtimeNodeRepo.recordMiss('node-1');
    runtimeNodeRepo.recordMiss('node-1');
    runtimeNodeRepo.recordMiss('node-1');

    expect(log.listStream(`binding:${binding.id}`).map((event) => event.type)).toEqual([
      'binding.started',
      'binding.finished',
    ]);
    expect(log.listStream('node:node-1').map((event) => event.type)).toEqual([
      'node.stale',
      'node.unreachable',
    ]);

    runtimeNodeRepo.register({ id: 'node-disconnect', kind: 'daemon', label: 'Disconnecting' });
    agentBindingRepo.upsert({
      conversationId: 'project-1',
      agentId: 'reviewer',
      nodeId: 'node-disconnect',
      runtimeId: 'runtime-2',
    });
    runtimeNodeRepo.setStatus('node-disconnect', 'stale');
    expect(log.listStream('node:node-disconnect').map((event) => event.type))
      .toEqual(['node.stale']);
  });
});
