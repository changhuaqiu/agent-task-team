// src/lib/agent-context/tiers/systemTier.ts
//
// System tier — stable collaboration protocol + per-turn protocol hints +
// behaviour. Never trimmed by BudgetGuard (parts here carry tier='system').
//
// collaboration dedup: when the 'identity' cluster is included, the
// bootstrap channel (systemPrompt, built by assembleContext) already carries
// buildCollaborationLayer(), so this tier skips it to avoid duplication.
// When identity is omitted (wakeup/closure/iterate), systemPrompt is not
// built, so the protocol rides this message channel.

import { buildCollaborationLayer } from '../layers/collaborationLayer';
import { buildProtocolLayer, deriveRoleFromCard } from '../layers/protocolLayer';
import { buildBehaviorLayer } from '../layers/behaviorLayer';
import { buildProtocolHint } from '../protocolHints';
import type { TierRenderInput } from './tierContext';

export function renderSystemTier({ ctx, push, isIncluded }: TierRenderInput): void {
  const { req, roleCard, task } = ctx;

  // Stable collaboration contract. Dedup against the bootstrap channel:
  // assembleContext builds systemPrompt (which carries buildCollaborationLayer)
  // ONLY when the 'identity' cluster is included. So skip the message-channel
  // push exactly when identity is included — that is the real condition under
  // which the protocol would otherwise appear twice. Keying on identity (not
  // isFirstWake) is correct because isFirstWake and the identity directive are
  // independent: a wakeup/closure first-wake has identity=omit, so its
  // systemPrompt is never built and the protocol must ride this channel.
  const identityCarriesCollaboration = isIncluded('identity');
  if (!identityCarriesCollaboration) {
    push('protocol', 'collaboration', buildCollaborationLayer(), { tier: 'system', importance: 0.8 });
  }

  // Protocol hints per scenario (wakeup reason, dispatch intent, …).
  const protocol = buildProtocolLayer({
    agentId: req.agentId,
    agentRole: deriveRoleFromCard(roleCard),
    projectPath: '', // P1 暂不传，待 TASK-004 升级
    hasTaskAssignment: !!task,
    isPlanner: roleCard?.category === 'planner',
  });
  const protocolHint = buildProtocolHint(ctx.scenario, req.wakeup);
  push('protocol', 'protocol', [protocol, protocolHint].filter(Boolean).join('\n\n'), { tier: 'system', importance: 0.8 });

  // Behaviour / close-the-loop requirements.
  push('protocol', 'behavior', buildBehaviorLayer(), { tier: 'system', importance: 0.7 });
}
