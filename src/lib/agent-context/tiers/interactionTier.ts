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
    private: true,
    source: req.agentId,
  });

  // User message — only when this is not an A2A handoff turn (handoff turns
  // carry their own focus via taskTier). Private to this agent.
  if (!req.a2aHandoff) {
    push('focus', 'userMessage', buildUserMessageLayer(req.rawPrompt), { private: true, source: req.agentId });
  }
}
