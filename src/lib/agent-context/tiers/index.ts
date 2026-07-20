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
import type { TierContext } from './tierContext';
import { renderSystemTier } from './systemTier';
import { renderKnowledgeTier } from './knowledgeTier';
import { renderTaskTier } from './taskTier';
import { renderInteractionTier } from './interactionTier';

export type { TierContext } from './tierContext';

export interface ContextAssemblyPart extends BudgetPart {
  cluster: ContextCluster;
}

export function renderAllTiers(ctx: TierContext): ContextAssemblyPart[] {
  const parts: ContextAssemblyPart[] = [];

  const push = (
    cluster: ContextCluster,
    layer: string,
    content: string | null | undefined,
    opts: { tier: BudgetPart['tier']; importance: number; scope?: string; private?: boolean; source?: string },
  ) => {
    if (content) {
      parts.push({ cluster, layer, content, ...opts });
    }
  };

  const input = { ctx, push };

  renderSystemTier(input);
  renderKnowledgeTier(input);
  renderTaskTier(input);
  renderInteractionTier(input);

  return parts;
}
