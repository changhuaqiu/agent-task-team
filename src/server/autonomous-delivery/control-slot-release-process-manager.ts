import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { ControlDecisionRepository } from './control-decision-repository';

export class ControlSlotReleaseProcessManager {
  private readonly decisions: ControlDecisionRepository;

  constructor(private readonly database?: Database.Database) {
    this.decisions = new ControlDecisionRepository(database);
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (
      event.type !== 'context.snapshot.rejected'
      &&
      event.type !== 'runtime.invocation.blocked'
      &&
      event.type !== 'runtime.invocation.started'
      && event.type !== 'runtime.invocation.terminated'
    ) return;
    if (signal.aborted) throw signal.reason ?? new Error('control_slot_release_aborted');
    if (
      event.type === 'runtime.invocation.blocked'
      || event.type === 'context.snapshot.rejected'
    ) {
      const workId = (event.payload as { workId?: unknown }).workId;
      if (typeof workId !== 'string' || !workId.trim()) return;
      this.decisions.releaseSlotsForWork({
        workId: workId.trim(),
        reasonCode: event.type === 'runtime.invocation.blocked'
          ? 'invocation_preflight_blocked'
          : 'context_preflight_blocked',
        now: new Date(event.recordedAt),
      });
      return;
    }
    const invocation = (this.database ?? getDb()).prepare(`
      SELECT work_id FROM invocation WHERE id=?
    `).get(event.invocationId) as { work_id: string | null } | undefined;
    if (!invocation?.work_id) return;
    this.decisions.releaseSlotsForWork({
      workId: invocation.work_id,
      reasonCode: event.type === 'runtime.invocation.started'
        ? 'invocation_started'
        : 'invocation_terminated_before_start_projection',
      now: new Date(event.recordedAt),
    });
  };
}
