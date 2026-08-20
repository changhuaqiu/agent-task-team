import type Database from 'better-sqlite3';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import { observationSpanRepo } from '../repositories/observation-span-repo';
import { spanPayloadRepo } from '../repositories/span-payload-repo';
import { PlatformEventLog } from '../platform-events/event-log';
import { PlatformEventDispatcher } from '../platform-events/dispatcher';
import type { PlatformEvent } from '../platform-events/types';
import {
  buildPhoenixTracePlan,
  PhoenixOtlpTraceSink,
  PhoenixTraceProjection,
  type PhoenixTracePlan,
  type PhoenixTraceSink,
} from './phoenix-export';
import {
  createPhoenixHandlerRegistration,
  phoenixHandlerId,
  resolvePhoenixExportConfig,
  type PhoenixExportConfig,
} from './phoenix-config';

const now = '2026-08-20T12:00:00.000Z';
const later = '2026-08-20T12:00:01.000Z';
const config: PhoenixExportConfig = {
  endpoint: 'http://127.0.0.1:6006/v1/traces',
  projectName: 'agent-task-team',
  exportContent: 'redacted',
};

async function startOtlpReceiver(initialStatus = 200, responseDelayMs = 0) {
  let status = initialStatus;
  const requests: Array<{ headers: Record<string, string | string[] | undefined>; body: Buffer }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks) });
      const finish = () => {
        response.statusCode = status;
        response.setHeader('content-type', 'application/x-protobuf');
        response.end();
      };
      if (responseDelayMs > 0) setTimeout(finish, responseDelayMs);
      else finish();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1/traces`,
    requests,
    setStatus(value: number) { status = value; },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => (
        error ? reject(error) : resolve()
      )));
    },
  };
}

function terminalEvent(db: Database.Database): PlatformEvent {
  return new PlatformEventLog({
    db,
    now: () => new Date(later),
    idFactory: () => 'event-terminal',
  }).append({
    type: 'runtime.invocation.terminated',
    category: 'runtime_lifecycle',
    projectId: 'project-1',
    streamKey: 'invocation:inv-1',
    aggregate: { type: 'invocation', id: 'inv-1' },
    actor: { type: 'runtime', id: 'daemon:local' },
    projectAgentId: 'implementer',
    invocationId: 'inv-1',
    correlationId: 'correlation-not-an-otel-id',
    occurredAt: later,
    payload: { outcome: 'completed', durationMs: 1_000 },
  });
}

describe('Phoenix observability projection', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    invocationRepo.create({
      id: 'inv-1',
      conversation_id: 'project-1',
      task_id: 'task-1',
      agent_id: 'implementer',
      engine: 'codex',
    });
    invocationRepo.transition('inv-1', { to: 'starting' });
    invocationRepo.transition('inv-1', { to: 'running' });
    invocationRepo.updateDispatchStatus('inv-1', 'completed', {
      tokenUsage: JSON.stringify({ codex: { inputTokens: 12, outputTokens: 8 } }),
    });
    invocationRepo.transition('inv-1', { to: 'terminated', outcome: 'completed' });

    observationSpanRepo.start({
      spanId: 'root-local',
      traceId: 'correlation-not-an-otel-id',
      name: 'agent.invoke',
      kind: 'agent',
      conversationId: 'project-1',
      taskId: 'task-1',
      agentId: 'implementer',
      invocationId: 'inv-1',
      chainId: 'chain-1',
      passId: 'pass-1',
      startedAt: now,
      attributes: {
        'gen_ai.operation.name': 'invoke_agent',
        'ath.runtime.engine': 'codex',
        unknown_secret: 'must-not-leak',
      },
    });
    spanPayloadRepo.put('root-local', 'system_prompt', 'Use api_key=top-secret-value');
    spanPayloadRepo.put('root-local', 'assembled_prompt', 'Implement the requested change');

    observationSpanRepo.start({
      spanId: 'message-local',
      traceId: 'correlation-not-an-otel-id',
      parentSpanId: 'root-local',
      name: 'agent.message',
      kind: 'message',
      conversationId: 'project-1',
      taskId: 'task-1',
      agentId: 'implementer',
      invocationId: 'inv-1',
      startedAt: '2026-08-20T12:00:00.100Z',
    });
    spanPayloadRepo.put('message-local', 'completion', 'Done. Bearer abcdefghijklmnop');
    spanPayloadRepo.put('message-local', 'thinking', 'private reasoning must never leave');
    observationSpanRepo.finish('message-local', 'ok', { endedAt: '2026-08-20T12:00:00.900Z' });

    observationSpanRepo.start({
      spanId: 'tool-local',
      traceId: 'correlation-not-an-otel-id',
      parentSpanId: 'root-local',
      name: 'tool.execute',
      kind: 'tool',
      conversationId: 'project-1',
      taskId: 'task-1',
      agentId: 'implementer',
      invocationId: 'inv-1',
      startedAt: '2026-08-20T12:00:00.200Z',
      attributes: {
        'gen_ai.tool.name': 'Shell',
        'gen_ai.tool.call.id': 'call-1',
      },
    });
    spanPayloadRepo.put('tool-local', 'tool_input', '{"password":"tool-secret"}');
    spanPayloadRepo.put('tool-local', 'tool_output', 'ok');
    observationSpanRepo.finish('tool-local', 'ok', { endedAt: '2026-08-20T12:00:00.700Z' });
    observationSpanRepo.finish('root-local', 'ok', { endedAt: later });
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('stays disabled without an explicit collector and normalizes enabled configuration', () => {
    expect(resolvePhoenixExportConfig({})).toBeUndefined();
    const resolved = resolvePhoenixExportConfig({
      PHOENIX_COLLECTOR_ENDPOINT: 'http://127.0.0.1:6006/',
      ATH_PHOENIX_PROJECT_NAME: 'delivery-os',
      ATH_PHOENIX_EXPORT_CONTENT: 'redacted',
      PHOENIX_API_KEY: 'secret-key',
    });
    expect(resolved).toEqual({
      endpoint: 'http://127.0.0.1:6006/v1/traces',
      projectName: 'delivery-os',
      exportContent: 'redacted',
      apiKey: 'secret-key',
    });
    expect(phoenixHandlerId()).toBe('phoenix-trace-export:v1');
    expect(createPhoenixHandlerRegistration({
      PHOENIX_COLLECTOR_ENDPOINT: 'http://127.0.0.1:6006',
      PHOENIX_API_KEY: 'old-key',
    })?.id).toBe(createPhoenixHandlerRegistration({
      PHOENIX_COLLECTOR_ENDPOINT: 'http://127.0.0.1:6006',
      PHOENIX_API_KEY: 'rotated-key',
    })?.id);
    expect(resolvePhoenixExportConfig({
      PHOENIX_COLLECTOR_ENDPOINT: 'http://127.0.0.1:6006/v1/traces',
    })?.endpoint).toBe('http://127.0.0.1:6006/v1/traces');
    expect(resolvePhoenixExportConfig({
      PHOENIX_COLLECTOR_ENDPOINT: 'https://phoenix.example.test/collector/',
    })?.endpoint).toBe('https://phoenix.example.test/collector/v1/traces');
    expect(() => resolvePhoenixExportConfig({
      PHOENIX_COLLECTOR_ENDPOINT: 'file:///tmp/traces',
    })).toThrow('phoenix_export_endpoint_protocol_invalid');
    expect(createPhoenixHandlerRegistration({})).toBeUndefined();
  });

  it('builds a stable OpenInference tree with redacted content and no thinking or unknown attributes', () => {
    const first = buildPhoenixTracePlan('inv-1', config, db);
    const replay = buildPhoenixTracePlan('inv-1', config, db);
    expect(replay).toEqual(first);
    expect(first.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(first.spans.map((span) => span.spanId)).toEqual(
      expect.arrayContaining(first.spans.map(() => expect.stringMatching(/^[a-f0-9]{16}$/))),
    );
    const root = first.spans.find((span) => span.localSpanId === 'root-local')!;
    const message = first.spans.find((span) => span.localSpanId === 'message-local')!;
    const tool = first.spans.find((span) => span.localSpanId === 'tool-local')!;
    expect(root.attributes).toMatchObject({
      'openinference.span.kind': 'AGENT',
      'session.id': 'project-1',
      'agent.name': 'implementer',
      'ath.task.id': 'task-1',
      'ath.chain.id': 'chain-1',
      'ath.pass.id': 'pass-1',
    });
    expect(root.attributes).not.toHaveProperty('unknown_secret');
    expect(String(root.attributes['input.value'])).toContain('[REDACTED]');
    expect(String(root.attributes['input.value'])).not.toContain('top-secret-value');
    expect(String(root.attributes['output.value'])).toContain('[REDACTED]');
    expect(String(root.attributes['output.value'])).not.toContain('abcdefghijklmnop');
    expect(message.parentSpanId).toBe(root.spanId);
    expect(message.attributes).toMatchObject({
      'openinference.span.kind': 'LLM',
      'llm.system': 'codex',
      'llm.token_count.prompt': 12,
      'llm.token_count.completion': 8,
      'llm.token_count.total': 20,
    });
    expect(JSON.stringify(message.attributes)).not.toContain('private reasoning');
    expect(tool.parentSpanId).toBe(root.spanId);
    expect(tool.attributes).toMatchObject({
      'openinference.span.kind': 'TOOL',
      'gen_ai.tool.name': 'Shell',
      'gen_ai.tool.call.id': 'call-1',
    });
    expect(String(tool.attributes['input.value'])).toContain('[REDACTED]');
    expect(String(tool.attributes['input.value'])).not.toContain('tool-secret');
  });

  it('uses only bounded preview columns unless redacted payload export is explicitly enabled', () => {
    db.prepare(`UPDATE observation_span SET input_preview=?,output_preview=? WHERE span_id=?`)
      .run('preview prompt', 'preview answer', 'root-local');
    db.prepare(`UPDATE observation_span SET output_preview=? WHERE span_id=?`)
      .run('preview completion', 'message-local');
    db.exec('DROP TABLE observation_span_payload');
    const preview = buildPhoenixTracePlan('inv-1', { ...config, exportContent: 'preview' }, db);
    const root = preview.spans.find((span) => span.localSpanId === 'root-local')!;
    const message = preview.spans.find((span) => span.localSpanId === 'message-local')!;
    expect(root.attributes['input.value']).toContain('preview prompt');
    expect(root.attributes['output.value']).toBe('preview answer');
    expect(message.attributes['output.value']).toBe('preview completion');
  });

  it('enforces a trace-wide content budget before rendering redacted payloads', () => {
    spanPayloadRepo.put('root-local', 'assembled_prompt', 'x'.repeat(100_000));
    spanPayloadRepo.put('root-local', 'system_prompt', 'y'.repeat(100_000));
    const plan = buildPhoenixTracePlan('inv-1', config, db);
    const root = plan.spans.find((span) => span.localSpanId === 'root-local')!;
    expect(Buffer.byteLength(String(root.attributes['input.value']), 'utf8'))
      .toBeLessThanOrEqual(64 * 1024);
  });

  it('sends OTLP protobuf with the Phoenix project header through the production sink', async () => {
    const receiver = await startOtlpReceiver();
    try {
      const plan = buildPhoenixTracePlan('inv-1', config, db);
      await new PhoenixOtlpTraceSink().export(
        plan,
        { ...config, endpoint: receiver.endpoint },
        new AbortController().signal,
      );
      expect(receiver.requests).toHaveLength(1);
      expect(receiver.requests[0]!.headers['x-project-name']).toBe('agent-task-team');
      expect(receiver.requests[0]!.headers['content-type']).toContain('application/x-protobuf');
      expect(receiver.requests[0]!.body.byteLength).toBeGreaterThan(0);
    } finally {
      await receiver.close();
    }
  });

  it('returns promptly when an in-flight production export is aborted', async () => {
    const receiver = await startOtlpReceiver(200, 750);
    try {
      const controller = new AbortController();
      const startedAt = Date.now();
      setTimeout(() => controller.abort(new Error('abort-now')), 50);
      await expect(new PhoenixOtlpTraceSink().export(
        buildPhoenixTracePlan('inv-1', config, db),
        { ...config, endpoint: receiver.endpoint },
        controller.signal,
      )).rejects.toThrow('abort-now');
      expect(Date.now() - startedAt).toBeLessThan(400);
    } finally {
      await receiver.close();
    }
  });

  it('waits for the local durable projection and delegates one completed plan to the sink', async () => {
    const exported: PhoenixTracePlan[] = [];
    const sink: PhoenixTraceSink = {
      export: vi.fn(async (plan) => { exported.push(plan); }),
    };
    const projection = new PhoenixTraceProjection({ config, db, sink });
    const event = terminalEvent(db);
    const signal = new AbortController().signal;
    await expect(projection.handle(event, { signal }))
      .rejects.toThrow('phoenix_export_local_projection_not_ready');
    db.prepare(`
      INSERT INTO runtime_observability_projection(event_id,projected_at) VALUES (?,?)
    `).run(event.eventId, later);
    await projection.handle(event, { signal });
    expect(sink.export).toHaveBeenCalledTimes(1);
    expect(exported[0]).toMatchObject({ invocationId: 'inv-1', conversationId: 'project-1' });
  });

  it('surfaces exporter failures as retryable durable delivery errors', async () => {
    const event = terminalEvent(db);
    db.prepare(`
      INSERT INTO runtime_observability_projection(event_id,projected_at) VALUES (?,?)
    `).run(event.eventId, later);
    const sink: PhoenixTraceSink = { export: vi.fn(async () => { throw new Error('connection refused'); }) };
    const projection = new PhoenixTraceProjection({ config, db, sink });
    await expect(projection.handle(event, { signal: new AbortController().signal }))
      .rejects.toThrow('phoenix_export_failed:connection refused');
    expect(invocationRepo.getById('inv-1')).toMatchObject({ status: 'terminated', outcome: 'completed' });
  });

  it('retries a real OTLP HTTP failure without changing local delivery truth', async () => {
    const event = terminalEvent(db);
    db.prepare(`
      INSERT INTO runtime_observability_projection(event_id,projected_at) VALUES (?,?)
    `).run(event.eventId, later);
    const receiver = await startOtlpReceiver(500);
    try {
      const registration = createPhoenixHandlerRegistration({
        PHOENIX_COLLECTOR_ENDPOINT: receiver.endpoint,
        ATH_PHOENIX_PROJECT_NAME: 'agent-task-team',
      }, { db })!;
      const dispatcher = new PlatformEventDispatcher({
        db,
        now: () => new Date(later),
        retryDelayMs: () => 0,
      });
      dispatcher.register(registration);
      expect(dispatcher.recover().enqueued).toBe(1);
      expect(await dispatcher.drain()).toMatchObject({ failed: 1, succeeded: 0 });
      expect(db.prepare(`
        SELECT status,attempt_count,last_error FROM platform_event_delivery WHERE handler_id=?
      `).get(registration.id)).toMatchObject({
        status: 'queued',
        attempt_count: 1,
        last_error: expect.stringContaining('phoenix_export_failed'),
      });
      receiver.setStatus(200);
      expect(await dispatcher.drain()).toMatchObject({ failed: 0, succeeded: 1 });
      expect(receiver.requests).toHaveLength(2);
      expect(db.prepare(`
        SELECT status,attempt_count,last_error FROM platform_event_delivery WHERE handler_id=?
      `).get(registration.id)).toEqual({ status: 'succeeded', attempt_count: 2, last_error: null });
      expect(invocationRepo.getById('inv-1')).toMatchObject({ status: 'terminated', outcome: 'completed' });
    } finally {
      await receiver.close();
    }
  });
});
