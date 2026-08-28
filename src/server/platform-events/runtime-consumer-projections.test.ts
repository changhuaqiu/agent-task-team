import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { messageRepo } from '../repositories/message-repo';
import { sessionRepo } from '../repositories/session-repo';
import { AcpRuntimeEventCoordinator } from '../agent-runtime';
import { PlatformEventLog } from './event-log';
import { RuntimeMessageProjection } from './runtime-message-projection';
import { RuntimeObservabilityProjection } from './runtime-observability-projection';
import { RuntimeSocketProjection } from './runtime-socket-projection';

describe('Runtime Event consumer projections', () => {
  let db: Database.Database;
  let log: PlatformEventLog;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    const now = '2026-07-25T04:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    sessionRepo.create({
      id: 'session-1',
      conversationId: 'project-1',
      agentId: 'implementer',
    });
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'project-1',
      agent_id: 'implementer',
      session_id: 'session-1',
      engine: 'codex',
    });
    log = new PlatformEventLog({ db });
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  function recordTrace(withSessionLifecycle = false) {
    const coordinator = new AcpRuntimeEventCoordinator({
      context: {
        projectId: 'project-1',
        projectAgentId: 'implementer',
        invocationId: 'inv-1',
        logicalSessionId: 'session-1',
        runtimeActorId: 'local-daemon',
        correlationId: 'envelope-1',
      },
      engine: 'codex',
      runtimeNodeId: 'local-daemon',
      envelopeId: 'envelope-1',
      log,
    });
    coordinator.accept();
    coordinator.start();
    if (withSessionLifecycle) {
      coordinator.bindSession('session-1', 'runtime-session-1', 'created');
      coordinator.confirmSession('runtime-session-1');
    }
    coordinator.adapterEvent({ type: 'thinking', content: 'reasoning summary' });
    coordinator.adapterEvent({ type: 'text', content: 'hello' });
    coordinator.adapterEvent({
      type: 'tool_use',
      content: '',
      tool: { name: 'Shell', callId: 'call-1', input: 'pwd' },
    });
    coordinator.adapterEvent({
      type: 'tool_result',
      content: 'ok',
      tool: { name: 'Shell', callId: 'call-1', output: 'ok' },
    });
    coordinator.terminate({ status: 'completed', durationMs: 20 });
    return log.listStream('invocation:inv-1');
  }

  it('keeps invocation domain history separate from canonical Runtime history', () => {
    const runtimeEvents = recordTrace();
    expect(runtimeEvents.map((event) => event.type)).toEqual([
      'runtime.invocation.accepted',
      'runtime.invocation.started',
      'runtime.thinking.segment.completed',
      'runtime.message.segment.completed',
      'runtime.tool.started',
      'runtime.tool.completed',
      'runtime.invocation.terminated',
    ]);
    expect(log.listStream('domain-invocation:inv-1').map((event) => event.type))
      .toEqual(['invocation.planned']);
  });

  it('projects messages and observability exactly once under replay', async () => {
    const events = recordTrace();
    const onProjected = vi.fn();
    const messages = new RuntimeMessageProjection({ db, onProjected });
    const observability = new RuntimeObservabilityProjection({ db });
    const context = { signal: new AbortController().signal };

    for (const event of [...events, ...events]) {
      await messages.handle(event, context);
      await observability.handle(event, context);
    }

    expect(messageRepo.getByConversation('project-1').map((row) => row.content)).toEqual([
      'reasoning summary',
      'hello',
      '🔧 使用工具：Shell',
    ]);
    expect(db.prepare('SELECT COUNT(*) count FROM runtime_message_projection').get())
      .toEqual({ count: 3 });
    expect(onProjected).toHaveBeenCalledTimes(3);
    expect(onProjected.mock.calls.map(([message]) => message.content)).toEqual([
      'reasoning summary',
      'hello',
      '🔧 使用工具：Shell',
    ]);
    expect(db.prepare('SELECT COUNT(*) count FROM runtime_observability_projection').get())
      .toEqual({ count: events.length });
    expect(db.prepare(`
      SELECT role,content FROM observation_span_payload WHERE role='thinking'
    `).all()).toEqual([{ role: 'thinking', content: 'reasoning summary' }]);
    expect(db.prepare(`
      SELECT span_id,status FROM observation_span
      WHERE invocation_id='inv-1' ORDER BY span_id
    `).all()).toEqual([
      { span_id: 'runtime-invocation:inv-1', status: 'ok' },
      { span_id: 'runtime-message:inv-1', status: 'ok' },
      { span_id: 'runtime-tool:inv-1:call-1', status: 'ok' },
    ]);
  });

  it('projects structured runtime events through the isolated project view channel', () => {
    const publish = vi.fn();
    const projection = new RuntimeSocketProjection({ publish });
    for (const event of recordTrace(true)) projection.project(event);

    expect(publish).toHaveBeenCalledWith('project-1', expect.objectContaining({
      type: 'runtime.session',
      delivery: 'durable',
      actor: { type: 'runtime', id: 'local-daemon' },
      agent: { type: 'agent', id: 'implementer' },
      correlationId: 'envelope-1',
      source: expect.objectContaining({ streamKey: 'invocation:inv-1' }),
    }));
    expect(publish).toHaveBeenCalledWith('project-1', expect.objectContaining({
      type: 'runtime.tool.started',
      subject: { type: 'invocation', id: 'inv-1' },
    }));
    expect(publish).toHaveBeenCalledWith('project-1', expect.objectContaining({
      type: 'runtime.completed',
    }));
    expect(publish.mock.calls.some(([, event]) => (
      (event as { type?: string }).type === 'runtime.text.delta'
    ))).toBe(false);
  });
});
