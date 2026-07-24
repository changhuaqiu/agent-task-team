import type { PlatformEventHandler } from './dispatcher';
import { AgentInbox, type AgentWorkCommand } from './agent-inbox';
import type { PlatformEvent } from './types';

export interface AgentInboxRoute {
  projectAgentId: string;
  command: AgentWorkCommand;
}

export type AgentInboxRouteResolver = (
  event: PlatformEvent,
) => AgentInboxRoute | readonly AgentInboxRoute[] | undefined;

export interface AgentInboxRouterOptions {
  inbox?: AgentInbox;
  resolve: AgentInboxRouteResolver;
}

/**
 * Lower-half router: domain facts become agent commands, but this component
 * never starts a runtime. Event/agent idempotency makes dispatcher retry safe.
 */
export class AgentInboxRouter {
  private readonly inbox: AgentInbox;

  constructor(private readonly options: AgentInboxRouterOptions) {
    this.inbox = options.inbox ?? new AgentInbox();
  }

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.category !== 'domain') return;
    if (signal.aborted) throw signal.reason ?? new Error('agent_inbox_router_aborted');
    const resolved = this.options.resolve(event);
    const routes = resolved
      ? Array.isArray(resolved) ? resolved : [resolved]
      : [];
    const uniqueRoutes = new Map<string, AgentInboxRoute>();
    for (const route of routes) {
      const existing = uniqueRoutes.get(route.projectAgentId);
      if (existing && JSON.stringify(existing.command) !== JSON.stringify(route.command)) {
        throw new Error(`agent_inbox_router_conflicting_route:${route.projectAgentId}`);
      }
      uniqueRoutes.set(route.projectAgentId, route);
    }
    for (const route of uniqueRoutes.values()) {
      if (signal.aborted) throw signal.reason ?? new Error('agent_inbox_router_aborted');
      this.inbox.enqueue({
        projectId: event.projectId,
        projectAgentId: route.projectAgentId,
        sourceEvent: event,
        idempotencyKey: `event:${event.eventId}:agent:${route.projectAgentId}`,
        command: route.command,
      });
    }
  };
}
