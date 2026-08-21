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
      && event.type !== 'agent.work.cancelled'
      && event.type !== 'agent.work.expired'
      && event.type !== 'work.authority.closed'
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
    if (event.type === 'work.authority.closed') {
      const workEpoch = (event.payload as { workEpoch?: unknown }).workEpoch;
      if (!Number.isSafeInteger(workEpoch) || Number(workEpoch) <= 0) return;
      this.decisions.releaseSlotsForWork({
        workId: event.aggregate.id,
        workEpoch: Number(workEpoch),
        reasonCode: 'work_authority_closed',
        now: new Date(event.recordedAt),
      });
      return;
    }
    if (event.type === 'agent.work.cancelled' || event.type === 'agent.work.expired') {
      if (!event.inboxItemId) return;
      const row = (this.database ?? getDb()).prepare(`
        SELECT command_json FROM agent_inbox_item WHERE id=?
      `).get(event.inboxItemId) as { command_json: string } | undefined;
      if (!row) return;
      const workId = (JSON.parse(row.command_json) as { workId?: unknown }).workId;
      if (typeof workId !== 'string' || !workId.trim()) return;
      const reasonCode = (event.payload as { reasonCode?: unknown }).reasonCode;
      this.decisions.releaseSlotsForWork({
        workId: workId.trim(),
        reasonCode: `${event.type}:${
          typeof reasonCode === 'string' && reasonCode.trim() ? reasonCode.trim() : 'unknown'
        }`,
        now: new Date(event.recordedAt),
      });
      return;
    }
    const invocation = (this.database ?? getDb()).prepare(`
      SELECT work_id,work_epoch FROM invocation WHERE id=?
    `).get(event.invocationId) as { work_id: string | null; work_epoch: number | null } | undefined;
    if (!invocation?.work_id) return;
    this.decisions.releaseSlotsForWork({
      workId: invocation.work_id,
      ...(invocation.work_epoch ? { workEpoch: invocation.work_epoch } : {}),
      reasonCode: event.type === 'runtime.invocation.started'
        ? 'invocation_started'
        : 'invocation_terminated_before_start_projection',
      now: new Date(event.recordedAt),
    });
  };
}
