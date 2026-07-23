import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { generateSortableId } from '../repositories/sortable-id';
import {
  PLATFORM_EVENT_SCHEMA_VERSION,
  type AppendPlatformEvent,
  type PlatformEvent,
  type PlatformEventActorType,
  type PlatformEventCategory,
} from './types';

interface PlatformEventRow {
  id: string;
  type: string;
  category: PlatformEventCategory;
  schema_version: number;
  project_id: string;
  stream_key: string;
  stream_sequence: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number | null;
  actor_type: PlatformEventActorType;
  actor_id: string;
  subject_type: string | null;
  subject_id: string | null;
  project_agent_id: string | null;
  invocation_id: string | null;
  inbox_item_id: string | null;
  correlation_id: string;
  causation_id: string | null;
  dedupe_key: string | null;
  payload: string;
  occurred_at: string;
  recorded_at: string;
}

export class PlatformEventDedupeConflictError extends Error {
  readonly reasonCode = 'platform_event_dedupe_conflict';

  constructor(readonly dedupeKey: string) {
    super(`Platform event dedupe key is already bound to different content: ${dedupeKey}`);
    this.name = 'PlatformEventDedupeConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  const serialized = JSON.stringify(canonicalize(value));
  if (serialized === undefined) {
    throw new Error('platform_event_payload_not_serializable');
  }
  return serialized;
}

function fromRow<TType extends string = string, TPayload = unknown>(
  row: PlatformEventRow,
): PlatformEvent<TType, TPayload> {
  if (row.schema_version !== PLATFORM_EVENT_SCHEMA_VERSION) {
    throw new Error(`platform_event_schema_unsupported:${row.schema_version}`);
  }
  return {
    eventId: row.id,
    type: row.type as TType,
    category: row.category,
    schemaVersion: PLATFORM_EVENT_SCHEMA_VERSION,
    projectId: row.project_id,
    streamKey: row.stream_key,
    streamSequence: row.stream_sequence,
    aggregate: {
      type: row.aggregate_type,
      id: row.aggregate_id,
      ...(row.aggregate_version === null ? {} : { version: row.aggregate_version }),
    },
    actor: { type: row.actor_type, id: row.actor_id },
    ...(row.subject_type && row.subject_id
      ? { subject: { type: row.subject_type, id: row.subject_id } }
      : {}),
    ...(row.project_agent_id ? { projectAgentId: row.project_agent_id } : {}),
    ...(row.invocation_id ? { invocationId: row.invocation_id } : {}),
    ...(row.inbox_item_id ? { inboxItemId: row.inbox_item_id } : {}),
    correlationId: row.correlation_id,
    ...(row.causation_id ? { causationId: row.causation_id } : {}),
    ...(row.dedupe_key ? { dedupeKey: row.dedupe_key } : {}),
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    payload: JSON.parse(row.payload) as TPayload,
  };
}

function sameDedupeContent(row: PlatformEventRow, input: AppendPlatformEvent): boolean {
  return row.type === input.type
    && row.category === input.category
    && row.project_id === input.projectId
    && row.stream_key === input.streamKey
    && row.aggregate_type === input.aggregate.type
    && row.aggregate_id === input.aggregate.id
    && row.aggregate_version === (input.aggregate.version ?? null)
    && row.actor_type === input.actor.type
    && row.actor_id === input.actor.id
    && row.subject_type === (input.subject?.type ?? null)
    && row.subject_id === (input.subject?.id ?? null)
    && row.project_agent_id === (input.projectAgentId ?? null)
    && row.invocation_id === (input.invocationId ?? null)
    && row.inbox_item_id === (input.inboxItemId ?? null)
    && row.correlation_id === input.correlationId
    && row.causation_id === (input.causationId ?? null)
    && (input.occurredAt === undefined || row.occurred_at === input.occurredAt)
    && row.payload === canonicalJson(input.payload);
}

export type PlatformEventStreamGuard = (events: readonly PlatformEvent[]) => void;

export interface PlatformEventLogOptions {
  db?: Database.Database;
  now?: () => Date;
  idFactory?: () => string;
}

export class PlatformEventLog {
  private readonly database?: Database.Database;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: PlatformEventLogOptions = {}) {
    this.database = options.db;
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => generateSortableId('pev'));
  }

  append<TType extends string, TPayload>(
    input: AppendPlatformEvent<TType, TPayload>,
    guard?: PlatformEventStreamGuard,
  ): PlatformEvent<TType, TPayload> {
    const db = this.database ?? getDb();
    const append = db.transaction(() => {
      if (input.dedupeKey) {
        const existing = db.prepare(
          'SELECT * FROM platform_event WHERE dedupe_key = ?',
        ).get(input.dedupeKey) as PlatformEventRow | undefined;
        if (existing) {
          if (!sameDedupeContent(existing, input)) {
            throw new PlatformEventDedupeConflictError(input.dedupeKey);
          }
          return fromRow<TType, TPayload>(existing);
        }
      }

      const existingStreamRows = db.prepare(`
        SELECT * FROM platform_event
        WHERE stream_key = ?
        ORDER BY stream_sequence ASC
      `).all(input.streamKey) as PlatformEventRow[];
      guard?.(existingStreamRows.map((row) => fromRow(row)));
      const streamSequence = (existingStreamRows.at(-1)?.stream_sequence ?? 0) + 1;
      const recordedAt = this.now().toISOString();
      const eventId = this.idFactory();
      const payload = canonicalJson(input.payload);

      db.prepare(`
        INSERT INTO platform_event (
          id,type,category,schema_version,project_id,stream_key,stream_sequence,
          aggregate_type,aggregate_id,aggregate_version,actor_type,actor_id,
          subject_type,subject_id,project_agent_id,invocation_id,inbox_item_id,
          correlation_id,causation_id,dedupe_key,payload,occurred_at,recorded_at
        ) VALUES (
          ?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
        )
      `).run(
        eventId,
        input.type,
        input.category,
        input.projectId,
        input.streamKey,
        streamSequence,
        input.aggregate.type,
        input.aggregate.id,
        input.aggregate.version ?? null,
        input.actor.type,
        input.actor.id,
        input.subject?.type ?? null,
        input.subject?.id ?? null,
        input.projectAgentId ?? null,
        input.invocationId ?? null,
        input.inboxItemId ?? null,
        input.correlationId,
        input.causationId ?? null,
        input.dedupeKey ?? null,
        payload,
        input.occurredAt ?? recordedAt,
        recordedAt,
      );

      return this.getById<TType, TPayload>(eventId)!;
    });
    return append.immediate();
  }

  getById<TType extends string = string, TPayload = unknown>(
    eventId: string,
  ): PlatformEvent<TType, TPayload> | undefined {
    const row = (this.database ?? getDb()).prepare(
      'SELECT * FROM platform_event WHERE id = ?',
    ).get(eventId) as PlatformEventRow | undefined;
    return row ? fromRow<TType, TPayload>(row) : undefined;
  }

  getByDedupeKey<TType extends string = string, TPayload = unknown>(
    dedupeKey: string,
  ): PlatformEvent<TType, TPayload> | undefined {
    const row = (this.database ?? getDb()).prepare(
      'SELECT * FROM platform_event WHERE dedupe_key = ?',
    ).get(dedupeKey) as PlatformEventRow | undefined;
    return row ? fromRow<TType, TPayload>(row) : undefined;
  }

  listStream(streamKey: string, afterSequence = 0): PlatformEvent[] {
    const rows = (this.database ?? getDb()).prepare(`
      SELECT * FROM platform_event
      WHERE stream_key = ? AND stream_sequence > ?
      ORDER BY stream_sequence ASC
    `).all(streamKey, afterSequence) as PlatformEventRow[];
    return rows.map((row) => fromRow(row));
  }

  listByInvocation(invocationId: string): PlatformEvent[] {
    const rows = (this.database ?? getDb()).prepare(`
      SELECT * FROM platform_event
      WHERE invocation_id = ?
      ORDER BY stream_sequence ASC
    `).all(invocationId) as PlatformEventRow[];
    return rows.map((row) => fromRow(row));
  }

  listByProjectAgent(projectId: string, projectAgentId: string): PlatformEvent[] {
    const rows = (this.database ?? getDb()).prepare(`
      SELECT * FROM platform_event
      WHERE project_id = ? AND project_agent_id = ?
      ORDER BY recorded_at ASC, id ASC
    `).all(projectId, projectAgentId) as PlatformEventRow[];
    return rows.map((row) => fromRow(row));
  }
}
