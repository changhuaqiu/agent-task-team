// src/lib/agent-context/tiers/interactionTier.ts
//
// Interaction tier — the current turn's input: the user message (or, when
// an A2A handoff is present, nothing — taskTier owns that) and the team-log
// delta envelope. Highest trim priority by recency, but userMessage carries
// high importance because it is the actual instruction.

import { buildUserMessageLayer } from '../layers/userMessageLayer';
import { renderTeamLogEnvelope } from '../teamLog';
import type { TierRenderInput } from './tierContext';

export function renderInteractionTier({ ctx, push }: TierRenderInput): void {
  const { req, teamLogEnvelope } = ctx;

  // Team-log delta — what changed since this agent last saw the project.
  // Private (only the current agent's view is consistent).
  push('situation', 'teamLog', teamLogEnvelope ? renderTeamLogEnvelope(teamLogEnvelope) : '', {
    tier: 'project',
    importance: 0.75,
    scope: '/project',
    private: true,
  });

  // User message — only when this is not an A2A handoff turn (handoff turns
  // carry their own focus via taskTier).
  if (!req.a2aHandoff) {
    // 可见性标签；filterVisible/assertVisibility 强制执行在 P2 接入（见 spec §9）
    push('dialog', 'userMessage', buildUserMessageLayer(req.rawPrompt), { tier: 'project', importance: 0.9, scope: `/project/${req.agentId}`, private: true });
  }
}
