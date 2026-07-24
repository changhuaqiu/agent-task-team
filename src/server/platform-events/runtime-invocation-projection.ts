import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { PlatformEventLog } from './event-log';
import type { PlatformEvent, RuntimeLifecyclePayloadMap } from './types';

export interface RuntimeInvocationProjectionRow {
  invocation_id: string;
  project_id: string;
  project_agent_id: string;
  status: 'accepted' | 'running' | 'terminated';
  outcome: string | null;
  reason_code: string | null;
  accepted_at: string;
  started_at: string | null;
  terminated_at: string | null;
  last_stream_sequence: number;
  updated_at: string;
}

export class RuntimeInvocationProjection {
  constructor(private readonly database?: Database.Database) {}

  handle(event: PlatformEvent, signal?: AbortSignal): void {
    if (signal?.aborted) throw new Error('runtime_invocation_projection_aborted');
    if (!event.invocationId || !event.projectAgentId) {
      throw new Error('runtime_invocation_projection_context_missing');
    }
    const db = this.database ?? getDb();
    if (event.type === 'runtime.invocation.accepted') {
      db.prepare(`
        INSERT INTO runtime_invocation_projection (
          invocation_id,project_id,project_agent_id,status,outcome,reason_code,
          accepted_at,started_at,terminated_at,last_stream_sequence,updated_at
        ) VALUES (?, ?, ?, 'accepted', NULL, NULL, ?, NULL, NULL, ?, ?)
        ON CONFLICT(invocation_id) DO UPDATE SET
          project_id=excluded.project_id,
          project_agent_id=excluded.project_agent_id,
          status='accepted',
          outcome=NULL,
          reason_code=NULL,
          accepted_at=excluded.accepted_at,
          started_at=NULL,
          terminated_at=NULL,
          last_stream_sequence=excluded.last_stream_sequence,
          updated_at=excluded.updated_at
        WHERE excluded.last_stream_sequence > runtime_invocation_projection.last_stream_sequence
      `).run(
        event.invocationId,
        event.projectId,
        event.projectAgentId,
        event.occurredAt,
        event.streamSequence,
        event.recordedAt,
      );
      return;
    }
    if (event.type === 'runtime.invocation.started') {
      this.updateExisting(event, `
        status='running',
        started_at=@occurredAt
      `);
      return;
    }
    if (event.type === 'runtime.invocation.terminated') {
      const payload = event.payload as RuntimeLifecyclePayloadMap['runtime.invocation.terminated'];
      this.updateExisting(event, `
        status='terminated',
        outcome=@outcome,
        reason_code=@reasonCode,
        terminated_at=@occurredAt
      `, {
        outcome: payload.outcome,
        reasonCode: payload.reasonCode ?? null,
      });
    }
  }

  rebuild(projectId?: string): number {
    const db = this.database ?? getDb();
    const rebuild = db.transaction(() => {
      if (projectId) {
        db.prepare('DELETE FROM runtime_invocation_projection WHERE project_id=?').run(projectId);
      } else {
        db.prepare('DELETE FROM runtime_invocation_projection').run();
      }
      const rows = db.prepare(`
        SELECT id FROM platform_event
        WHERE category='runtime_lifecycle'
          AND type IN (
            'runtime.invocation.accepted',
            'runtime.invocation.started',
            'runtime.invocation.terminated'
          )
          ${projectId ? 'AND project_id=?' : ''}
        ORDER BY recorded_at ASC, id ASC
      `).all(...(projectId ? [projectId] : [])) as Array<{ id: string }>;
      const log = new PlatformEventLog({ db });
      for (const row of rows) this.handle(log.getById(row.id)!);
      return rows.length;
    });
    return rebuild.immediate();
  }

  listByProject(projectId: string): RuntimeInvocationProjectionRow[] {
    return (this.database ?? getDb()).prepare(`
      SELECT * FROM runtime_invocation_projection
      WHERE project_id=?
      ORDER BY updated_at DESC, invocation_id DESC
    `).all(projectId) as RuntimeInvocationProjectionRow[];
  }

  private updateExisting(
    event: PlatformEvent,
    assignments: string,
    extras: Record<string, unknown> = {},
  ): void {
    const result = (this.database ?? getDb()).prepare(`
      UPDATE runtime_invocation_projection SET
        ${assignments},
        last_stream_sequence=@streamSequence,
        updated_at=@recordedAt
      WHERE invocation_id=@invocationId
        AND last_stream_sequence < @streamSequence
    `).run({
      invocationId: event.invocationId,
      occurredAt: event.occurredAt,
      streamSequence: event.streamSequence,
      recordedAt: event.recordedAt,
      ...extras,
    });
    if (result.changes !== 1) {
      const existing = (this.database ?? getDb()).prepare(`
        SELECT last_stream_sequence FROM runtime_invocation_projection WHERE invocation_id=?
      `).get(event.invocationId) as { last_stream_sequence: number } | undefined;
      if (!existing) throw new Error('runtime_invocation_projection_acceptance_missing');
    }
  }
}
