import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { invocationRepo } from '../repositories/invocation-repo';
import {
  observationSpanRepo,
  type ObservationSpanRow,
} from '../repositories/observation-span-repo';
import { spanPayloadRepo } from '../repositories/span-payload-repo';
import type { PlatformEventHandler } from './dispatcher';
import type { PlatformEvent } from './types';

export interface RuntimeObservabilityProjectionOptions {
  db?: Database.Database;
  onUpdated?: (projectId: string, invocationId: string) => void;
}

export class RuntimeObservabilityProjection {
  private readonly database?: Database.Database;

  constructor(private readonly options: RuntimeObservabilityProjectionOptions = {}) {
    this.database = options.db;
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (!event.type.startsWith('runtime.') || !event.invocationId) return;
    if (signal.aborted) throw signal.reason ?? new Error('runtime_observability_projection_aborted');
    const db = this.database ?? getDb();
    const projected = db.transaction(() => {
      const receipt = db.prepare(
        `SELECT 1 FROM runtime_observability_projection WHERE event_id=?`,
      ).get(event.eventId);
      if (receipt) return false;

      const root = this.ensureRoot(event);
      if (root) this.projectEvent(event, root);
      db.prepare(`
        INSERT INTO runtime_observability_projection (event_id,projected_at)
        VALUES (?,?)
      `).run(event.eventId, new Date().toISOString());
      return true;
    })();
    if (projected) this.options.onUpdated?.(event.projectId, event.invocationId);
  };

  private projectEvent(event: PlatformEvent, root: ObservationSpanRow): void {
    if (event.type === 'runtime.message.segment.completed') {
      const payload = event.payload as { text?: string };
      const span = this.ensureSpan(event, root, `runtime-message:${event.invocationId}`, 'agent.message', 'message');
      if (payload.text) spanPayloadRepo.put(span.span_id, 'completion', payload.text, event.streamSequence);
      return;
    }
    if (event.type === 'runtime.thinking.segment.completed') {
      const payload = event.payload as { text?: string };
      const span = this.ensureSpan(event, root, `runtime-message:${event.invocationId}`, 'agent.message', 'message');
      if (payload.text) spanPayloadRepo.put(span.span_id, 'thinking', payload.text, event.streamSequence);
      return;
    }
    if (event.type === 'runtime.tool.started') {
      const payload = event.payload as { callId: string; toolName: string; input?: string; origin?: string };
      const span = this.ensureSpan(event, root, this.toolSpanId(event.invocationId!, payload.callId), 'tool.execute', 'tool', {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.name': payload.toolName,
        'gen_ai.tool.call.id': payload.callId,
        'ath.tool.origin': payload.origin,
      });
      if (payload.input !== undefined) spanPayloadRepo.put(span.span_id, 'tool_input', payload.input);
      return;
    }
    if (event.type === 'runtime.tool.completed' || event.type === 'runtime.tool.failed') {
      const payload = event.payload as { callId: string; output?: string; message?: string; reasonCode?: string };
      const spanId = this.toolSpanId(event.invocationId!, payload.callId);
      const span = this.ensureSpan(event, root, spanId, 'tool.execute', 'tool', {
        'gen_ai.operation.name': 'execute_tool',
        'gen_ai.tool.call.id': payload.callId,
      });
      if (payload.output !== undefined) spanPayloadRepo.put(span.span_id, 'tool_output', payload.output);
      observationSpanRepo.finish(span.span_id, event.type === 'runtime.tool.failed' ? 'error' : 'ok', {
        outputPreview: payload.output,
        errorMessage: payload.message ?? payload.reasonCode,
      });
      return;
    }
    if (event.type === 'runtime.plan.updated') {
      const payload = event.payload as { content?: string };
      const span = this.ensureSpan(event, root, `runtime-plan:${event.eventId}`, 'agent.plan', 'workflow', {
        'gen_ai.operation.name': 'plan',
      });
      observationSpanRepo.finish(span.span_id, 'ok', { outputPreview: payload.content });
      return;
    }
    if (event.type === 'runtime.invocation.terminated') {
      const payload = event.payload as { outcome: string; reasonCode?: string };
      const status = payload.outcome === 'completed' ? 'ok' : payload.outcome === 'cancelled' ? 'cancelled' : 'error';
      observationSpanRepo.finishOpenByInvocation(event.invocationId!, status, payload.reasonCode);
    }
  }

  private ensureRoot(event: PlatformEvent): ObservationSpanRow | undefined {
    const db = this.database ?? getDb();
    const existing = db.prepare(`
      SELECT * FROM observation_span
      WHERE invocation_id=? AND parent_span_id IS NULL
      ORDER BY started_at ASC, span_id ASC LIMIT 1
    `).get(event.invocationId) as ObservationSpanRow | undefined;
    if (existing) return existing;
    const invocation = event.invocationId
      ? invocationRepo.getById(event.invocationId)
      : undefined;
    return observationSpanRepo.start({
      spanId: `runtime-invocation:${event.invocationId}`,
      traceId: event.correlationId,
      name: 'agent.invoke',
      kind: 'agent',
      conversationId: event.projectId,
      taskId: invocation?.task_id || undefined,
      agentId: event.projectAgentId,
      invocationId: event.invocationId,
      envelopeId: event.causationId,
      attributes: {
        'ath.schema.version': 1,
        'ath.projection.source': 'platform_event',
      },
      startedAt: event.occurredAt,
    });
  }

  private ensureSpan(
    event: PlatformEvent,
    root: ObservationSpanRow,
    spanId: string,
    name: string,
    kind: 'message' | 'tool' | 'workflow',
    attributes?: Record<string, unknown>,
  ): ObservationSpanRow {
    const existing = observationSpanRepo.get(spanId);
    if (existing) return existing;
    const invocation = event.invocationId ? invocationRepo.getById(event.invocationId) : undefined;
    return observationSpanRepo.start({
      spanId,
      traceId: root.trace_id,
      parentSpanId: root.span_id,
      name,
      kind,
      conversationId: event.projectId,
      taskId: invocation?.task_id || undefined,
      agentId: event.projectAgentId,
      invocationId: event.invocationId,
      envelopeId: root.envelope_id ?? undefined,
      attributes: {
        'ath.schema.version': 1,
        'ath.projection.source': 'platform_event',
        ...(attributes ?? {}),
      },
      startedAt: event.occurredAt,
    });
  }

  private toolSpanId(invocationId: string, callId: string): string {
    return `runtime-tool:${invocationId}:${callId}`;
  }
}
