// src/lib/agent-context/tiers/systemTier.ts
//
// System tier — stable collaboration protocol + per-turn protocol hints +
// behaviour. Never trimmed by BudgetGuard (parts here carry tier='system').
//
// collaboration dedup: when the bootstrap channel carries identity/protocol,
// this tier skips the same collaboration text. Semantic scenario and first
// session bootstrap are intentionally independent.

import { buildCollaborationLayer } from '../layers/collaborationLayer';
import { buildProtocolLayer, deriveRoleFromCard } from '../layers/protocolLayer';
import { buildBehaviorLayer } from '../layers/behaviorLayer';
import { buildProtocolHint } from '../protocolHints';
import type { TierRenderInput } from './tierContext';

export function renderSystemTier({ ctx, push }: TierRenderInput): void {
  const { req, roleCard, task } = ctx;

  // Stable collaboration contract. Dedup against the bootstrap channel:
  // assembleContext may bootstrap an explicit Team Harness scenario without
  // changing the semantic scenario to `init`. Key on the actual bootstrap
  // decision so collaboration appears exactly once.
  const identityCarriesCollaboration = ctx.bootstrapIdentity;
  if (!identityCarriesCollaboration) {
    push('protocol', 'collaboration', buildCollaborationLayer(), { tier: 'system', importance: 0.8 });
  }

  // Protocol hints per scenario (wakeup reason, dispatch intent, …).
  const protocol = buildProtocolLayer({
    agentId: req.agentId,
    agentRole: deriveRoleFromCard(roleCard),
    hasTaskAssignment: !!task,
  });
  const protocolHint = buildProtocolHint(ctx.scenario, req.wakeup);
  push('protocol', 'protocol', [protocol, protocolHint].filter(Boolean).join('\n\n'), { tier: 'system', importance: 0.8 });

  // Behaviour / close-the-loop requirements.
  push('protocol', 'behavior', buildBehaviorLayer(), { tier: 'system', importance: 0.7 });
}
