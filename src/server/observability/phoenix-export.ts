import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  context,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import { ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  type IdGenerator,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { getDb } from '../db';
import { redactObservationPreview, sanitizeObservationPayload } from './redaction';
import type { ObservationSpanKind, ObservationSpanRow } from '../repositories/observation-span-repo';
import type { ObservationPayloadRole, ObservationSpanPayloadRow } from '../repositories/span-payload-repo';
import type { InvocationRow } from '../repositories/invocation-repo';
import type {
  PlatformEvent,
} from '../platform-events/types';
import type { PhoenixExportConfig } from './phoenix-config';

const MAX_EXTERNAL_CONTENT_BYTES = 64 * 1024;
const MAX_EXTERNAL_CONTENT_CHARS = 64 * 1024;
const OTLP_EXPORT_TIMEOUT_MS = 10_000;

type PhoenixAttributeValue = string | number | boolean;

export interface PhoenixSpanPlan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  localSpanId: string;
  localTraceId: string;
  localKind: ObservationSpanKind;
  status: ObservationSpanRow['status'];
  errorMessage?: string;
  startedAt: string;
  endedAt: string;
  attributes: Record<string, PhoenixAttributeValue>;
}

export interface PhoenixTracePlan {
  traceId: string;
  invocationId: string;
  conversationId: string;
  spans: PhoenixSpanPlan[];
}

export interface PhoenixTraceSink {
  export(plan: PhoenixTracePlan, config: PhoenixExportConfig, signal: AbortSignal): Promise<void>;
}

export interface PhoenixTraceProjectionOptions {
  config: PhoenixExportConfig;
  db?: Database.Database;
  sink?: PhoenixTraceSink;
}

function deterministicHex(length: 16 | 32, ...parts: string[]): string {
  const value = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, length);
  return /^0+$/.test(value) ? `${value.slice(0, -1)}1` : value;
}

function parseRecord(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function safeAttribute(value: unknown): PhoenixAttributeValue | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  return redactObservationPreview(value, 2_000);
}

function externalText(value: string | undefined, mode: PhoenixExportConfig['exportContent']): string | undefined {
  if (!value) return undefined;
  if (mode === 'preview') return redactObservationPreview(value, 2_000);
  return sanitizeObservationPayload(value, MAX_EXTERNAL_CONTENT_BYTES)?.content;
}

function payloadText(
  payloads: ObservationSpanPayloadRow[],
  role: Exclude<ObservationPayloadRole, 'thinking'>,
  mode: PhoenixExportConfig['exportContent'],
): string | undefined {
  const content = payloads
    .filter((payload) => payload.role === role)
    .sort((left, right) => left.seq - right.seq)
    .map((payload) => payload.content)
    .join('');
  return externalText(content, mode);
}

function mimeType(value: string): string {
  try {
    JSON.parse(value);
    return 'application/json';
  } catch {
    return 'text/plain';
  }
}

function openInferenceKind(kind: ObservationSpanKind): 'AGENT' | 'LLM' | 'TOOL' | 'PROMPT' | 'CHAIN' {
  if (kind === 'agent') return 'AGENT';
  if (kind === 'message') return 'LLM';
  if (kind === 'tool') return 'TOOL';
  if (kind === 'context') return 'PROMPT';
  return 'CHAIN';
}

function tokenUsage(value: string | null | undefined): { input: number; output: number; total: number } {
  const totals = { input: 0, output: 0, explicitTotal: 0 };
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (typeof item === 'number' && Number.isFinite(item)) {
        const normalized = key.replace(/[^a-z]/gi, '').toLowerCase();
        if (/(?:input|prompt)tokens?/.test(normalized)) totals.input += item;
        else if (/(?:output|completion)tokens?/.test(normalized)) totals.output += item;
        else if (/totaltokens?/.test(normalized)) totals.explicitTotal += item;
      } else {
        visit(item);
      }
    }
  };
  if (value) {
    try { visit(JSON.parse(value)); } catch { /* malformed usage is ignored */ }
  }
  return {
    input: totals.input,
    output: totals.output,
    total: totals.explicitTotal || totals.input + totals.output,
  };
}

function orderSpans(rows: ObservationSpanRow[]): ObservationSpanRow[] {
  const ordered = [...rows].sort((left, right) =>
    left.started_at.localeCompare(right.started_at) || left.span_id.localeCompare(right.span_id));
  const root = ordered.find((span) => !span.parent_span_id && span.kind === 'agent')
    ?? ordered.find((span) => !span.parent_span_id)
    ?? ordered[0];
  if (!root) return [];
  const result = [root];
  const added = new Set([root.span_id]);
  let pending = ordered.filter((span) => span.span_id !== root.span_id);
  while (pending.length > 0) {
    const ready = pending.filter((span) => !span.parent_span_id || added.has(span.parent_span_id));
    if (ready.length === 0) {
      result.push(...pending);
      break;
    }
    result.push(...ready);
    ready.forEach((span) => added.add(span.span_id));
    const readyIds = new Set(ready.map((span) => span.span_id));
    pending = pending.filter((span) => !readyIds.has(span.span_id));
  }
  return result;
}

export function buildPhoenixTracePlan(
  invocationId: string,
  config: PhoenixExportConfig,
  db: Database.Database = getDb(),
): PhoenixTracePlan {
  const invocation = db.prepare('SELECT * FROM invocation WHERE id=?').get(invocationId) as InvocationRow | undefined;
  if (!invocation || invocation.status !== 'terminated') {
    throw new Error('phoenix_export_invocation_not_ready');
  }
  const rows = db.prepare(`
    SELECT * FROM observation_span
    WHERE invocation_id=?
    ORDER BY started_at,span_id
  `).all(invocationId) as ObservationSpanRow[];
  if (rows.length === 0) throw new Error('phoenix_export_trace_missing');
  if (rows.some((span) => span.status === 'running' || !span.ended_at)) {
    throw new Error('phoenix_export_trace_not_ready');
  }
  const ordered = orderSpans(rows);
  const root = ordered[0];
  const payloadRows = config.exportContent === 'redacted'
    ? db.prepare(`
        WITH bounded_payload AS (
          SELECT payload.*,
            COALESCE(SUM(payload.byte_size) OVER (
              ORDER BY payload.span_id,payload.role,payload.seq
              ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ), 0) AS byte_offset
          FROM observation_span_payload payload
          JOIN observation_span span ON span.span_id=payload.span_id
          WHERE span.invocation_id=? AND payload.role<>'thinking'
        )
        SELECT span_id,role,seq,
          substr(content,1,MAX(0,? - byte_offset)) AS content,
          MIN(byte_size,MAX(0,? - byte_offset)) AS byte_size,
          CASE WHEN byte_size > MAX(0,? - byte_offset) THEN 1 ELSE truncated END AS truncated,
          created_at
        FROM bounded_payload
        WHERE byte_offset < ?
        ORDER BY span_id,role,seq
      `).all(
        invocationId,
        MAX_EXTERNAL_CONTENT_CHARS,
        MAX_EXTERNAL_CONTENT_CHARS,
        MAX_EXTERNAL_CONTENT_CHARS,
        MAX_EXTERNAL_CONTENT_CHARS,
      ) as ObservationSpanPayloadRow[]
    : [];
  const payloadsBySpan = new Map<string, ObservationSpanPayloadRow[]>();
  for (const payload of payloadRows) {
    payloadsBySpan.set(payload.span_id, [...(payloadsBySpan.get(payload.span_id) ?? []), payload]);
  }
  const rootPayloads = payloadsBySpan.get(root.span_id) ?? [];
  const rootPrompt = payloadText(rootPayloads, 'assembled_prompt', config.exportContent)
    ?? externalText(root.input_preview ?? undefined, config.exportContent);
  const rootSystem = payloadText(rootPayloads, 'system_prompt', config.exportContent);
  const completion = externalText(
    ordered
      .filter((span) => span.kind === 'message')
      .map((span) => payloadText(payloadsBySpan.get(span.span_id) ?? [], 'completion', config.exportContent) ?? '')
      .join(''),
    config.exportContent,
  );
  const usage = tokenUsage(invocation.token_usage ?? invocation.usage);
  const traceId = deterministicHex(32, 'phoenix-trace', invocationId, root.trace_id);
  const externalIds = new Map(ordered.map((span) => [
    span.span_id,
    deterministicHex(16, 'phoenix-span', invocationId, span.span_id),
  ]));

  const spans = ordered.map((row, index): PhoenixSpanPlan => {
    const sourceAttributes = parseRecord(row.attributes);
    const rowPayloads = payloadsBySpan.get(row.span_id) ?? [];
    const attributes: Record<string, PhoenixAttributeValue> = {
      'openinference.span.kind': openInferenceKind(row.kind),
      'session.id': invocation.conversation_id,
      'ath.local.trace_id': row.trace_id,
      'ath.local.span_id': row.span_id,
      'ath.invocation.id': invocation.id,
      'ath.conversation.id': invocation.conversation_id,
      'ath.span.kind': row.kind,
    };
    const known = {
      'gen_ai.operation.name': sourceAttributes['gen_ai.operation.name'],
      'gen_ai.agent.name': sourceAttributes['gen_ai.agent.name'],
      'gen_ai.tool.name': sourceAttributes['gen_ai.tool.name'],
      'gen_ai.tool.call.id': sourceAttributes['gen_ai.tool.call.id'],
      'ath.runtime.engine': sourceAttributes['ath.runtime.engine'] ?? invocation.engine,
      'ath.runtime.id': sourceAttributes['ath.runtime.id'],
      'ath.dispatch.source': sourceAttributes['ath.dispatch.source'],
      'ath.context.scenario': sourceAttributes['ath.context.scenario'],
      'ath.tool.origin': sourceAttributes['ath.tool.origin'],
    };
    for (const [key, value] of Object.entries(known)) {
      const safe = safeAttribute(value);
      if (safe !== undefined) attributes[key] = safe;
    }
    if (row.agent_id) attributes['agent.name'] = row.agent_id;
    if (row.task_id) attributes['ath.task.id'] = row.task_id;
    if (invocation.work_id) attributes['ath.work.id'] = invocation.work_id;
    if (invocation.work_epoch !== null) attributes['ath.work.epoch'] = invocation.work_epoch;
    if (row.chain_id) attributes['ath.chain.id'] = row.chain_id;
    if (row.pass_id) attributes['ath.pass.id'] = row.pass_id;
    if (row.envelope_id) attributes['ath.envelope.id'] = row.envelope_id;

    const input = row.kind === 'agent' || row.kind === 'message'
      ? rootPrompt
      : row.kind === 'tool'
        ? payloadText(rowPayloads, 'tool_input', config.exportContent)
          ?? externalText(row.input_preview ?? undefined, config.exportContent)
        : externalText(row.input_preview ?? undefined, config.exportContent);
    const output = row.kind === 'agent'
      ? completion ?? externalText(row.output_preview ?? undefined, config.exportContent)
      : row.kind === 'message'
        ? payloadText(rowPayloads, 'completion', config.exportContent)
          ?? externalText(row.output_preview ?? undefined, config.exportContent)
        : row.kind === 'tool'
          ? payloadText(rowPayloads, 'tool_output', config.exportContent)
            ?? externalText(row.output_preview ?? undefined, config.exportContent)
          : externalText(row.output_preview ?? undefined, config.exportContent);
    if (input) {
      const renderedInputValue = row.kind === 'agent' || row.kind === 'message'
        ? JSON.stringify({ ...(rootSystem ? { system: rootSystem } : {}), prompt: input })
        : input;
      const renderedInput = externalText(renderedInputValue, config.exportContent)!;
      attributes['input.value'] = renderedInput;
      attributes['input.mime_type'] = row.kind === 'agent' || row.kind === 'message'
        ? 'application/json'
        : mimeType(input);
    }
    if (output) {
      attributes['output.value'] = output;
      attributes['output.mime_type'] = mimeType(output);
    }
    if (row.kind === 'message') {
      attributes['llm.system'] = invocation.engine ?? 'unknown';
      if (usage.input > 0) attributes['llm.token_count.prompt'] = usage.input;
      if (usage.output > 0) attributes['llm.token_count.completion'] = usage.output;
      if (usage.total > 0) attributes['llm.token_count.total'] = usage.total;
    }
    return {
      traceId,
      spanId: externalIds.get(row.span_id)!,
      ...(index > 0 ? {
        parentSpanId: externalIds.get(
          row.parent_span_id && externalIds.has(row.parent_span_id)
            ? row.parent_span_id
            : root.span_id,
        ),
      } : {}),
      name: row.name,
      localSpanId: row.span_id,
      localTraceId: row.trace_id,
      localKind: row.kind,
      status: row.status,
      ...(row.error_message ? { errorMessage: redactObservationPreview(row.error_message, 2_000) } : {}),
      startedAt: row.started_at,
      endedAt: row.ended_at!,
      attributes,
    };
  });
  return {
    traceId,
    invocationId,
    conversationId: invocation.conversation_id,
    spans,
  };
}

class PlannedIdGenerator implements IdGenerator {
  private traceGenerated = false;
  private spanIndex = 0;

  constructor(
    private readonly traceId: string,
    private readonly spanIds: string[],
  ) {}

  generateTraceId(): string {
    if (this.traceGenerated) throw new Error('phoenix_export_unexpected_trace_id_request');
    this.traceGenerated = true;
    return this.traceId;
  }

  generateSpanId(): string {
    const value = this.spanIds[this.spanIndex];
    if (!value) throw new Error('phoenix_export_unexpected_span_id_request');
    this.spanIndex += 1;
    return value;
  }
}

/**
 * Holds the complete planned Trace until forceFlush so exporter callback failures
 * remain part of the durable handler result. BatchSpanProcessor may begin an
 * un-awaited batch from onEnd; a fast HTTP failure can then reach only OTel's
 * global error handler and make forceFlush appear successful.
 */
class AwaitableTraceSpanProcessor implements SpanProcessor {
  private readonly endedSpans: ReadableSpan[] = [];
  private inFlight?: Promise<void>;
  private closed = false;

  constructor(private readonly exporter: SpanExporter) {}

  onStart(): void {}

  onEnd(span: ReadableSpan): void {
    if (!this.closed) this.endedSpans.push(span);
  }

  forceFlush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const batch = this.endedSpans.splice(0);
    if (batch.length === 0) return Promise.resolve();
    const pending = new Promise<void>((resolve, reject) => {
      this.exporter.export(batch, (result) => {
        if (result.code === ExportResultCode.SUCCESS) resolve();
        else reject(result.error ?? new Error(`phoenix_export_otlp_failed:${result.code}`));
      });
    });
    this.inFlight = pending.finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  async shutdown(): Promise<void> {
    this.closed = true;
    await this.forceFlush();
    await this.exporter.shutdown();
  }
}

export class PhoenixOtlpTraceSink implements PhoenixTraceSink {
  async export(plan: PhoenixTracePlan, config: PhoenixExportConfig, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw signal.reason ?? new Error('phoenix_export_aborted');
    const exporter = new OTLPTraceExporter({
      url: config.endpoint,
      timeoutMillis: OTLP_EXPORT_TIMEOUT_MS,
      headers: {
        'x-project-name': config.projectName,
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
    });
    const processor = new AwaitableTraceSpanProcessor(exporter);
    const provider = new NodeTracerProvider({
      idGenerator: new PlannedIdGenerator(plan.traceId, plan.spans.map((span) => span.spanId)),
      resource: resourceFromAttributes({
        'service.name': 'agent-task-team',
        'service.version': '0.1.0',
        'openinference.project.name': config.projectName,
      }),
      spanProcessors: [processor],
    });
    const tracer = provider.getTracer('agent-task-team.phoenix-exporter', '1.0.0');
    const rootContext = trace.deleteSpan(context.active());
    const activeSpans = new Map<string, ReturnType<typeof tracer.startSpan>>();
    let primaryError: unknown;
    const abort = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason ?? new Error('phoenix_export_aborted')), { once: true });
    });
    try {
      for (const item of plan.spans) {
        const parent = item.parentSpanId ? activeSpans.get(item.parentSpanId) : undefined;
        const spanContext = parent ? trace.setSpan(rootContext, parent) : rootContext;
        const span = tracer.startSpan(item.name, {
          attributes: item.attributes,
          startTime: new Date(item.startedAt),
        }, spanContext);
        const actual = span.spanContext();
        if (actual.traceId !== item.traceId || actual.spanId !== item.spanId) {
          throw new Error('phoenix_export_identity_mismatch');
        }
        activeSpans.set(item.spanId, span);
      }
      for (const item of [...plan.spans].reverse()) {
        const span = activeSpans.get(item.spanId)!;
        if (item.status === 'ok') span.setStatus({ code: SpanStatusCode.OK });
        else if (item.status === 'error' || item.status === 'cancelled') {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            ...(item.errorMessage ? { message: item.errorMessage } : {}),
          });
        }
        span.end(new Date(item.endedAt));
      }
      await Promise.race([provider.forceFlush(), abort]);
    } catch (error) {
      primaryError = error;
      throw error;
    } finally {
      if (signal.aborted) {
        // The OTel HTTP exporter does not expose per-request cancellation. Do
        // not hold the shared durable worker after its AbortSignal fires; the
        // explicit exporter timeout above bounds this detached cleanup.
        void provider.shutdown().catch(() => undefined);
      } else {
        try {
          await provider.shutdown();
        } catch (shutdownError) {
          if (!primaryError) throw shutdownError;
        }
      }
    }
  }
}

export class PhoenixTraceProjection {
  private readonly db?: Database.Database;
  private readonly sink: PhoenixTraceSink;

  constructor(private readonly options: PhoenixTraceProjectionOptions) {
    this.db = options.db;
    this.sink = options.sink ?? new PhoenixOtlpTraceSink();
  }

  readonly handle = async (event: PlatformEvent, { signal }: { signal: AbortSignal }): Promise<void> => {
    if (event.type !== 'runtime.invocation.terminated' || !event.invocationId) return;
    const db = this.db ?? getDb();
    const localProjection = db.prepare(`
      SELECT 1 FROM runtime_observability_projection WHERE event_id=?
    `).get(event.eventId);
    if (!localProjection) throw new Error('phoenix_export_local_projection_not_ready');
    const plan = buildPhoenixTracePlan(event.invocationId, this.options.config, db);
    try {
      await this.sink.export(plan, this.options.config, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('phoenix_export_')) throw error;
      throw new Error(`phoenix_export_failed:${message.slice(0, 1_000)}`);
    }
  };
}
