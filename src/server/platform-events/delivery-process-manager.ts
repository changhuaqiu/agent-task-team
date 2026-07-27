import type { AdvancementCause } from '../autonomous-delivery/types';
import type { PlatformEventHandler } from './dispatcher';

export interface DeliveryAdvancementPort {
  /**
   * Accept an advancement request. The target owns durable execution/recovery;
   * this boundary returns after admission rather than after a long action.
   */
  advanceProject(
    projectId: string,
    cause: AdvancementCause,
    signal: AbortSignal,
    sourceEventId: string,
  ): void | Promise<unknown>;
}

export class DeliveryProcessManager {
  constructor(private readonly delivery: DeliveryAdvancementPort) {}

  readonly handle: PlatformEventHandler = async (event, { signal }) => {
    const advancesDelivery = (
      (event.category === 'domain'
        && (event.type.startsWith('task.') || event.type.startsWith('gate.')))
      || event.type === 'runtime.invocation.blocked'
      || event.type === 'runtime.session.resume_failed'
      || event.type === 'runtime.transport.degraded'
      || event.type === 'runtime.transport.recovered'
      || event.type === 'context.snapshot.rejected'
      || event.type.startsWith('effect.')
      || event.type === 'control.action.failed'
    );
    if (!advancesDelivery) return;
    if (signal.aborted) throw signal.reason ?? new Error('delivery_process_manager_aborted');
    const subjectRef = event.subject?.type === 'task'
      ? event.subject.id
      : event.subject?.type === 'invocation_attempt'
        ? event.subject.id
        : event.invocationId ?? event.aggregate.id;
    await this.delivery.advanceProject(
      event.projectId,
      {
        kind: 'fact_changed',
        ref: subjectRef,
      },
      signal,
      event.eventId,
    );
    if (signal.aborted) throw signal.reason ?? new Error('delivery_process_manager_aborted');
  };
}
