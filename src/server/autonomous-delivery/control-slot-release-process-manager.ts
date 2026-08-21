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
      const contractId = (event.payload as { contractId?: unknown }).contractId;
      const contract = typeof contractId === 'string' ? (this.database ?? getDb()).prepare(`
        SELECT causation_id FROM work_contract WHERE id=?
      `).get(contractId) as { causation_id: string } | undefined : undefined;
      if (contract && this.decisions.releaseSlot({
        actionId: contract.causation_id,
        reasonCode: 'work_authority_closed',
        now: new Date(event.recordedAt),
      })) return;
      this.decisions.releaseSlotsForWork({
        workId: event.aggregate.id,
        workEpoch: Number(workEpoch) - 1,
        reasonCode: 'work_authority_closed',
        now: new Date(event.recordedAt),
      });
      return;
    }
    if (event.type === 'agent.work.cancelled' || event.type === 'agent.work.expired') {
      if (!event.inboxItemId) return;
      const row = (this.database ?? getDb()).prepare(`
        SELECT idempotency_key FROM agent_inbox_item WHERE id=?
      `).get(event.inboxItemId) as { idempotency_key: string } | undefined;
      if (!row) return;
      const reasonCode = (event.payload as { reasonCode?: unknown }).reasonCode;
      this.decisions.releaseSlot({
        actionId: row.idempotency_key,
        reasonCode: `${event.type}:${
          typeof reasonCode === 'string' && reasonCode.trim() ? reasonCode.trim() : 'unknown'
        }`,
        now: new Date(event.recordedAt),
      });
      return;
    }
    const invocation = (this.database ?? getDb()).prepare(`
      SELECT invocation.work_id,invocation.work_epoch,contract.causation_id
      FROM invocation
      LEFT JOIN work_contract contract ON contract.id=invocation.work_contract_id
      WHERE invocation.id=?
    `).get(event.invocationId) as {
      work_id: string | null;
      work_epoch: number | null;
      causation_id: string | null;
    } | undefined;
    if (!invocation?.work_id) return;
    if (invocation.causation_id && this.decisions.releaseSlot({
      actionId: invocation.causation_id,
      reasonCode: event.type === 'runtime.invocation.started'
        ? 'invocation_started'
        : 'invocation_terminated_before_start_projection',
      now: new Date(event.recordedAt),
    })) return;
    this.decisions.releaseSlotsForWork({
      workId: invocation.work_id,
      ...(invocation.work_epoch && invocation.work_epoch > 0
        ? { workEpoch: invocation.work_epoch - 1 }
        : {}),
      reasonCode: event.type === 'runtime.invocation.started'
        ? 'invocation_started'
        : 'invocation_terminated_before_start_projection',
      now: new Date(event.recordedAt),
    });
  };
}
