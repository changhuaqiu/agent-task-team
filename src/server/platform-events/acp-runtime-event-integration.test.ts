import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTurnScopedAcpEventMapper } from '../agent/acp/agentEventMapper';
import { createTestDb } from '../db';
import { AcpRuntimeEventCoordinator } from './acp-runtime-event-coordinator';
import { PlatformEventLog } from './event-log';

describe('ACP Runtime event integration', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let coordinator: AcpRuntimeEventCoordinator;
  let id = 0;

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-07-24T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({
      db,
      now: () => new Date(now),
      idFactory: () => `pev-${++id}`,
    });
    coordinator = new AcpRuntimeEventCoordinator({
      context: {
        projectId: 'project-1',
        projectAgentId: 'implementer',
        invocationId: 'inv-1',
        logicalSessionId: 'logical-session-1',
        runtimeActorId: 'local-daemon',
        correlationId: 'dispatch-envelope-1',
      },
      engine: 'codex',
      runtimeNodeId: 'local-daemon',
      envelopeId: 'dispatch-envelope-1',
      log,
      now: () => 100,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('normalizes an ACP trace into one queryable ordered Runtime stream', () => {
    coordinator.accept();
    coordinator.start();

    const mapUpdate = createTurnScopedAcpEventMapper();
    const updates = [
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'working' },
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Shell',
        rawInput: { command: 'exit 1' },
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'in_progress',
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'failed',
        rawOutput: 'command failed',
      },
    ] as SessionUpdate[];

    for (const update of updates) {
      const event = mapUpdate(update);
      if (event) coordinator.adapterEvent(event);
    }
    coordinator.terminate({
      status: 'failed',
      reasonCode: 'tool_failed',
      durationMs: 25,
    });

    const events = log.listByInvocation('inv-1');
    expect(events.map((event) => event.type)).toEqual([
      'runtime.invocation.accepted',
      'runtime.invocation.started',
      'runtime.message.segment.completed',
      'runtime.tool.started',
      'runtime.tool.failed',
      'runtime.invocation.terminated',
    ]);
    expect(events.map((event) => event.streamSequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events.every((event) => (
      event.projectId === 'project-1'
      && event.projectAgentId === 'implementer'
      && event.invocationId === 'inv-1'
    ))).toBe(true);
  });

  it('records exactly one failed terminal when setup fails after acceptance', () => {
    coordinator.accept();
    coordinator.failSetup('internal_error');
    coordinator.failSetup('internal_error');

    const events = log.listByInvocation('inv-1');
    expect(events.map((event) => event.type)).toEqual([
      'runtime.invocation.accepted',
      'runtime.invocation.terminated',
    ]);
  });

  it('does not fail open when the canonical Runtime append is rejected', () => {
    expect(() => coordinator.start()).toThrow('before invocation acceptance');
    expect(log.listByInvocation('inv-1')).toEqual([]);
  });
});
