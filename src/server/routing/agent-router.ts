/**
 * Agent Router — Higher-level routing that combines mention parsing with business logic.
 *
 * Integrates with the store's dispatch logic but stays side-effect-free.
 */

import { parseMentions, type RoutingDecision } from './mention-parser';

export interface RouterDeps {
  /** Active agent IDs in the current conversation */
  participants: string[];
  /** Current agent status map (to avoid dispatching to busy agents) */
  agentStatus: Record<string, string>;
  /** Preferred agents for the conversation (optional) */
  preferredAgents?: string[];
}

/**
 * Determine routing for a user message.
 *
 * Combines mention parsing with business logic (skip busy agents).
 */
export function routeMessage(
  message: string,
  deps: RouterDeps,
): RoutingDecision {
  const decision = parseMentions(message, deps.participants);

  const availableTargets = decision.targets.filter(
    (id) => deps.agentStatus[id] !== 'busy',
  );

  if (availableTargets.length === 0 && decision.targets.length > 0) {
    return { ...decision, targets: decision.targets };
  }

  return { ...decision, targets: availableTargets.length > 0 ? availableTargets : decision.targets };
}

/**
 * Plan serial execution: each agent gets dispatched with a staggered delay.
 *
 * For v0, all agents receive the same prompt with a 1s delay between dispatches.
 */
export function planSerialExecution(
  targets: string[],
  prompt: string,
  _options: {
    taskId?: string;
    conversationId?: string;
  },
): Array<{ agentId: string; prompt: string; delay: number }> {
  return targets.map((agentId, index) => ({
    agentId,
    prompt,
    delay: index * 1000,
  }));
}
