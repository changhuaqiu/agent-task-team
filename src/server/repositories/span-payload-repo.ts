import { getDb } from '../db';
import { sanitizeObservationPayload } from '../observability/redaction';

export type ObservationPayloadRole =
  | 'system_prompt'
  | 'assembled_prompt'
  | 'completion'
  | 'tool_input'
  | 'tool_output'
  | 'thinking';

export interface ObservationSpanPayloadRow {
  span_id: string;
  role: ObservationPayloadRole;
  seq: number;
  content: string;
  byte_size: number;
  truncated: number;
  created_at: string;
}

const ROLE_LIMIT_BYTES = 256 * 1024;
const SPAN_LIMIT_BYTES = 1024 * 1024;

export const spanPayloadRepo = {
  put(spanId: string, role: ObservationPayloadRole, value: unknown, seq = 0): ObservationSpanPayloadRow | undefined {
    const current = getDb().prepare(`SELECT COALESCE(SUM(byte_size), 0) AS total
      FROM observation_span_payload WHERE span_id = ? AND NOT (role = ? AND seq = ?)`)
      .get(spanId, role, seq) as { total: number };
    const remaining = Math.max(0, SPAN_LIMIT_BYTES - Number(current.total || 0));
    const sanitized = sanitizeObservationPayload(value, Math.min(ROLE_LIMIT_BYTES, remaining));
    if (!sanitized) return undefined;
    const truncated = sanitized.truncated || remaining <= 0;
    const now = new Date().toISOString();
    getDb().prepare(`INSERT INTO observation_span_payload
      (span_id, role, seq, content, byte_size, truncated, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(span_id, role, seq) DO UPDATE SET
        content = excluded.content,
        byte_size = excluded.byte_size,
        truncated = excluded.truncated,
        created_at = excluded.created_at`)
      .run(spanId, role, seq, sanitized.content, sanitized.byteSize, truncated ? 1 : 0, now);
    return spanPayloadRepo.get(spanId, role, seq);
  },

  get(spanId: string, role: ObservationPayloadRole, seq = 0): ObservationSpanPayloadRow | undefined {
    return getDb().prepare(`SELECT * FROM observation_span_payload
      WHERE span_id = ? AND role = ? AND seq = ?`).get(spanId, role, seq) as ObservationSpanPayloadRow | undefined;
  },

  listBySpan(spanId: string): ObservationSpanPayloadRow[] {
    return getDb().prepare(`SELECT * FROM observation_span_payload
      WHERE span_id = ? ORDER BY role, seq`).all(spanId) as ObservationSpanPayloadRow[];
  },
};
