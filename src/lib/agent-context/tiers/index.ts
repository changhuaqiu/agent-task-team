// src/lib/agent-context/tiers/index.ts
//
// Aggregates the four semantic tiers into a single parts list. Each tier
// owns its own push logic; this file only wires them together and supplies
// the shared push closure (gated by the scenario directive).
//
// Order matters only for readability inside the assembled prompt — the
// final ordering is applied by composeWithBudget (system→tool→project,
// then by importance). So tiers can be rendered in any order here.

import type { ContextCluster } from '../injectionPolicy';
import type { BudgetPart } from '../BudgetGuard';
import { getDirective } from '../injectionPolicy';
import type { TierContext } from './tierContext';
import { renderSystemTier } from './systemTier';
import { renderKnowledgeTier } from './knowledgeTier';
import { renderTaskTier } from './taskTier';
import { renderInteractionTier } from './interactionTier';

export type { TierContext } from './tierContext';

export function renderAllTiers(ctx: TierContext): BudgetPart[] {
  const parts: BudgetPart[] = [];

  const push = (
    cluster: ContextCluster,
    layer: string,
    content: string | null | undefined,
    opts: { tier: BudgetPart['tier']; importance: number; scope?: string; private?: boolean; source?: string },
  ) => {
    if (getDirective(ctx.scenario, ctx.archetype, cluster) === 'include' && content) {
      parts.push({ layer, content, ...opts });
    }
  };

  const isIncluded = (cluster: ContextCluster) =>
    getDirective(ctx.scenario, ctx.archetype, cluster) === 'include';

  const input = { ctx, push, isIncluded };

  renderSystemTier(input);
  renderKnowledgeTier(input);
  renderTaskTier(input);
  renderInteractionTier(input);

  return parts;
}
