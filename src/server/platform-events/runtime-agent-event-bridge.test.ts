import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventLog } from './event-log';
import { RuntimeAgentEventBridge } from './runtime-agent-event-bridge';
import { RuntimeEventPublisher } from './runtime-event-publisher';

describe('RuntimeAgentEventBridge', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let publisher: RuntimeEventPublisher;
  let bridge: RuntimeAgentEventBridge;
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
    publisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      runtimeActorId: 'local-daemon',
      correlationId: 'envelope-1',
    });
    publisher.publish('runtime.invocation.accepted', { envelopeId: 'envelope-1' });
    publisher.publish('runtime.invocation.started', { adapter: 'acp', engine: 'codex' });
    bridge = new RuntimeAgentEventBridge({
      invocationId: 'inv-1',
      publish: (type, payload) => {
        publisher.publish(type, payload);
      },
      isPlatformTool: (toolName) => toolName.startsWith('mcp.'),
    });
  });

  afterEach(() => {
    db.close();
  });

  it('maps adapter signals and preserves message segment boundaries', () => {
    bridge.publish({ type: 'text', content: 'hel' });
    bridge.publish({ type: 'text', content: 'lo' });
    bridge.publish({
      type: 'tool_use',
      content: '',
      tool: { name: 'mcp.task_create', callId: 'call-1', input: '{"title":"T"}' },
    });
    bridge.publish({
      type: 'tool_result',
      content: 'created',
      tool: { name: 'mcp.task_create', callId: 'call-1', output: 'created' },
    });
    bridge.publish({ type: 'text', content: 'done' });
    bridge.flush();

    const events = log.listByInvocation('inv-1').slice(2);
    expect(events.map((event) => event.type)).toEqual([
      'runtime.message.segment.completed',
      'runtime.tool.started',
      'runtime.tool.completed',
      'runtime.message.segment.completed',
    ]);
    expect(events.map((event) => event.payload)).toEqual([
      { segmentId: 'inv-1:message:0', text: 'hello' },
      {
        callId: 'call-1',
        input: '{"title":"T"}',
        origin: 'platform',
        toolName: 'mcp.task_create',
      },
      {
        callId: 'call-1',
        output: 'created',
        toolName: 'mcp.task_create',
      },
      { segmentId: 'inv-1:message:1', text: 'done' },
    ]);
  });

  it('correlates legacy tool events that lack call ids', () => {
    bridge.publish({
      type: 'tool_use',
      content: '',
      tool: { name: 'Read', input: 'README.md' },
    });
    bridge.publish({
      type: 'tool_result',
      content: 'contents',
      tool: { name: 'Read', output: 'contents' },
    });

    const toolEvents = log.listByInvocation('inv-1').slice(2);
    expect(toolEvents[0].payload).toMatchObject({
      callId: 'inv-1:legacy-tool:1',
      toolName: 'Read',
    });
    expect(toolEvents[1].payload).toMatchObject({
      callId: 'inv-1:legacy-tool:1',
      toolName: 'Read',
    });
  });

  it('maps adapter errors to warnings and usage to a separate event', () => {
    bridge.publish({
      type: 'error',
      content: 'adapter failed',
      usage: { inputTokens: 5, outputTokens: 2 },
    });

    const events = log.listByInvocation('inv-1').slice(2);
    expect(events.map((event) => event.type)).toEqual([
      'runtime.warning.raised',
      'runtime.usage.updated',
    ]);
  });

  it('preserves failed tool outcomes and ignores intermediate updates', () => {
    bridge.publish({
      type: 'tool_use',
      content: '',
      tool: { name: 'Shell', callId: 'call-1', input: 'exit 1' },
    });
    bridge.publish({
      type: 'tool_result',
      content: 'running',
      tool: { name: 'Shell', callId: 'call-1', status: 'in_progress' },
    });
    bridge.publish({
      type: 'tool_result',
      content: 'command failed',
      tool: { name: 'Shell', callId: 'call-1', status: 'failed' },
    });

    const toolEvents = log.listByInvocation('inv-1').slice(2);
    expect(toolEvents.map((event) => event.type)).toEqual([
      'runtime.tool.started',
      'runtime.tool.failed',
    ]);
    expect(toolEvents[1].payload).toEqual({
      callId: 'call-1',
      toolName: 'Shell',
      reasonCode: 'runtime_tool_failed',
      message: 'command failed',
    });
  });
});
