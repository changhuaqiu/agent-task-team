import type { AdvancementCause } from '../autonomous-delivery/supervisor';
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
    if (
      event.category !== 'domain'
      || (!event.type.startsWith('task.') && !event.type.startsWith('review.'))
    ) return;
    if (signal.aborted) throw signal.reason ?? new Error('delivery_process_manager_aborted');
    await this.delivery.advanceProject(
      event.projectId,
      {
        kind: 'fact_changed',
        ref: event.subject?.type === 'task' ? event.subject.id : event.aggregate.id,
      },
      signal,
      event.eventId,
    );
    if (signal.aborted) throw signal.reason ?? new Error('delivery_process_manager_aborted');
  };
}
