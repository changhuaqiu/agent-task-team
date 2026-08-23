import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { PlatformEvent } from '../platform-events/types';
import { CollaborationKernel } from './collaboration-kernel';
import type { WorkRequest } from './types';

export type EventWorkRequest = Omit<WorkRequest, 'projectId' | 'cause'> & {
  cause?: { correlationId?: string; causationId?: string };
};

export type CollaborationEventRouteResolver = (
  event: PlatformEvent,
) => EventWorkRequest | readonly EventWorkRequest[] | undefined;

export interface CollaborationEventRouterOptions {
  kernel?: CollaborationKernel;
  resolve: CollaborationEventRouteResolver;
}

/** Converts durable domain facts into the one WorkRequest interface. */
export class CollaborationEventRouter {
  private readonly kernel: CollaborationKernel;

  constructor(private readonly options: CollaborationEventRouterOptions) {
    this.kernel = options.kernel ?? new CollaborationKernel();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.category !== 'domain') return;
    if (signal.aborted) throw signal.reason ?? new Error('collaboration_event_router_aborted');
    const resolved = this.options.resolve(event);
    const routes = resolved ? Array.isArray(resolved) ? resolved : [resolved] : [];
    const unique = new Map<string, EventWorkRequest>();
    for (const route of routes) {
      const key = `${route.targetAgentId}:${route.idempotencyKey}`;
      const existing = unique.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(route)) {
        throw new Error(`collaboration_event_route_conflict:${key}`);
      }
      unique.set(key, route);
    }
    for (const route of unique.values()) {
      if (signal.aborted) throw signal.reason ?? new Error('collaboration_event_router_aborted');
      this.kernel.request({
        ...route,
        projectId: event.projectId,
        cause: {
          correlationId: route.cause?.correlationId ?? event.correlationId,
          causationId: route.cause?.causationId ?? event.eventId,
          event,
        },
      });
    }
  };
}
