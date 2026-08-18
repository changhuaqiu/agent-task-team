// src/lib/agent-context/tiers/taskTier.ts
//
// Task tier — the current focus: assigned task context and A2A handoff
// packet. High importance (trim last). Replaces the parallel push sites
// that lived inline in assembleContext.

import { buildTaskContextLayer } from '../layers/taskContextLayer';
import { buildA2ALayer } from '../layers/a2aLayer';
import type { TierRenderInput } from './tierContext';

export function renderTaskTier({ ctx, push }: TierRenderInput): void {
  const { req, task } = ctx;

  // Assigned task context (DoD, description, phase).
  if (task) {
    push('focus', 'task', buildTaskContextLayer(task), {});
  }

  // A2A handoff — if this turn was triggered by a pass, surface the packet
  // (goal + decisions + constraints) instead of a bare user message.
  if (req.a2aHandoff) {
    push('focus', 'a2a', buildA2ALayer({
      a2aFrom: req.a2aHandoff.title,
      a2aContent: req.a2aHandoff.possessionSummary,
      a2aContextSnapshot: JSON.stringify({
        ...req.a2aHandoff,
        possessionSummary: undefined,
      }),
    }), { evidenceRefs: req.a2aHandoff.evidenceRefs });
  }
}
