// src/lib/agent-context/tiers/systemTier.ts
//
// System tier — who you are + stable collaboration protocol. Never trimmed
// by BudgetGuard (parts here carry tier='system'). Holds the layers that
// define identity and protocol: collaboration, protocol, behavior.
//
// Note: role/project/projectStatus are rendered separately as the
// systemPrompt (bootstrap channel) from assembleContext; this tier handles
// the message-channel protocol layers that ship in every turn.

import { buildCollaborationLayer } from '../layers/collaborationLayer';
import { buildProtocolLayer, deriveRoleFromCard } from '../layers/protocolLayer';
import { buildBehaviorLayer } from '../layers/behaviorLayer';
import { buildProtocolHint } from '../protocolHints';
import type { TierRenderInput } from './tierContext';

export function renderSystemTier({ ctx, push }: TierRenderInput): void {
  const { req, roleCard, task } = ctx;

  // Stable collaboration contract — included in every turn.
  push('protocol', 'collaboration', buildCollaborationLayer(), { tier: 'system', importance: 0.8 });

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
