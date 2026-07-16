import { randomBytes } from 'node:crypto';
import { getDb } from '../db';
import { redactObservationPreview } from '../observability/redaction';

export type ObservationSpanKind = 'agent' | 'context' | 'tool' | 'workflow' | 'handoff' | 'runtime';
export type ObservationSpanStatus = 'running' | 'ok' | 'error' | 'cancelled';

export interface ObservationSpanRow {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  name: string;
  kind: ObservationSpanKind;
  status: ObservationSpanStatus;
  conversation_id: string;
  task_id: string | null;
  agent_id: string | null;
  invocation_id: string | null;
  envelope_id: string | null;
  chain_id: string | null;
  pass_id: string | null;
  attributes: string;
  input_preview: string | null;
  output_preview: string | null;
  error_message: string | null;
  started_at: string;
  ended_at: string | null;
}

export interface StartObservationSpanInput {
  spanId?: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: ObservationSpanKind;
  conversationId: string;
  taskId?: string;
  agentId?: string;
  invocationId?: string;
  envelopeId?: string;
  chainId?: string;
  passId?: string;
  attributes?: Record<string, unknown>;
  inputPreview?: unknown;
  startedAt?: string;
}

export function generateTraceId(): string { return randomBytes(16).toString('hex'); }
export function generateSpanId(): string { return randomBytes(8).toString('hex'); }

export const observationSpanRepo = {
  start(input: StartObservationSpanInput): ObservationSpanRow {
    const spanId = input.spanId ?? generateSpanId();
    const startedAt = input.startedAt ?? new Date().toISOString();
    getDb().prepare(`INSERT INTO observation_span (
      span_id, trace_id, parent_span_id, name, kind, status, conversation_id,
      task_id, agent_id, invocation_id, envelope_id, chain_id, pass_id,
      attributes, input_preview, started_at
    ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        spanId, input.traceId, input.parentSpanId ?? null, input.name, input.kind,
        input.conversationId, input.taskId ?? null, input.agentId ?? null,
        input.invocationId ?? null, input.envelopeId ?? null, input.chainId ?? null,
        input.passId ?? null, JSON.stringify(input.attributes ?? {}),
        redactObservationPreview(input.inputPreview) ?? null, startedAt,
      );
    return observationSpanRepo.get(spanId)!;
  },

  finish(spanId: string, status: Exclude<ObservationSpanStatus, 'running'>, input?: {
    outputPreview?: unknown;
    errorMessage?: string;
    attributes?: Record<string, unknown>;
    endedAt?: string;
  }): void {
    const row = observationSpanRepo.get(spanId);
    if (!row || row.status !== 'running') return;
    let attributes = row.attributes;
    if (input?.attributes) {
      let current: Record<string, unknown> = {};
      try { current = JSON.parse(row.attributes); } catch { /* keep empty */ }
      attributes = JSON.stringify({ ...current, ...input.attributes });
    }
    getDb().prepare(`UPDATE observation_span SET status = ?, attributes = ?,
      output_preview = ?, error_message = ?, ended_at = ? WHERE span_id = ?`)
      .run(status, attributes, redactObservationPreview(input?.outputPreview) ?? null,
        redactObservationPreview(input?.errorMessage) ?? null,
        input?.endedAt ?? new Date().toISOString(), spanId);
  },

  get(spanId: string): ObservationSpanRow | undefined {
    return getDb().prepare('SELECT * FROM observation_span WHERE span_id = ?').get(spanId) as ObservationSpanRow | undefined;
  },

  listByTrace(traceId: string): ObservationSpanRow[] {
    return getDb().prepare('SELECT * FROM observation_span WHERE trace_id = ? ORDER BY started_at, span_id')
      .all(traceId) as ObservationSpanRow[];
  },

  listByConversation(conversationId: string, limit = 2_000): ObservationSpanRow[] {
    return getDb().prepare(`SELECT * FROM observation_span WHERE conversation_id = ?
      ORDER BY started_at DESC, span_id DESC LIMIT ?`).all(conversationId, limit) as ObservationSpanRow[];
  },

  finishOpenByInvocation(invocationId: string, status: Exclude<ObservationSpanStatus, 'running'>, errorMessage?: string): void {
    const rows = getDb().prepare(`SELECT span_id FROM observation_span
      WHERE invocation_id = ? AND status = 'running' ORDER BY started_at DESC`)
      .all(invocationId) as { span_id: string }[];
    for (const row of rows) observationSpanRepo.finish(row.span_id, status, { errorMessage });
  },
};
