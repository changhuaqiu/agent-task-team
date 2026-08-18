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
import type { ContextFragment, ContextSubject } from '../context-contracts';
import type { TierContext } from './tierContext';
import { renderSystemTier } from './systemTier';
import { renderKnowledgeTier } from './knowledgeTier';
import { renderTaskTier } from './taskTier';
import { renderInteractionTier } from './interactionTier';

export type { TierContext } from './tierContext';

interface NativeFragmentIdentity {
  id: string;
  kind: string;
  producer: string;
}

const IDENTITIES: Record<string, NativeFragmentIdentity> = {
  collaboration: { id: 'platform:collaboration', kind: 'platform.collaboration', producer: 'platform-protocol' },
  protocol: { id: 'platform:protocol', kind: 'platform.protocol', producer: 'platform-protocol' },
  behavior: { id: 'platform:behavior', kind: 'platform.behavior', producer: 'platform-protocol' },
  tool: { id: 'tool:registry', kind: 'tool.registry', producer: 'tool-registry' },
  team: { id: 'team:roster', kind: 'team.roster', producer: 'team-runtime' },
  teamPack: { id: 'team:pack', kind: 'team.pack', producer: 'team-runtime' },
  history: { id: 'message:history', kind: 'message.history', producer: 'message-log' },
  task: { id: 'task:current', kind: 'task.current', producer: 'task-graph' },
  a2a: { id: 'a2a:handoff', kind: 'a2a.handoff', producer: 'a2a' },
  teamLog: { id: 'team-log:delta', kind: 'team-log.delta', producer: 'team-log' },
  userMessage: { id: 'message:user', kind: 'message.user', producer: 'message-log' },
};

function identityFor(layer: string): NativeFragmentIdentity {
  if (layer.startsWith('skill:')) {
    return { id: layer, kind: 'skill.compiled', producer: 'skill-runtime' };
  }
  const identity = IDENTITIES[layer];
  if (!identity) throw new Error(`unknown_context_layer: ${layer}`);
  return identity;
}

function subjectFor(layer: string, ctx: TierContext): ContextSubject {
  if (layer === 'team' || layer === 'teamPack') {
    return { kind: 'team', id: ctx.conversationId };
  }
  if ((layer === 'task' || layer === 'a2a') && ctx.req.taskId) {
    return { kind: 'task', id: ctx.req.taskId };
  }
  return { kind: 'agent', id: ctx.agentId };
}

export function renderAllTiers(ctx: TierContext, observedAt: string): ContextFragment[] {
  const fragments: ContextFragment[] = [];

  const push = (
    cluster: ContextCluster,
    layer: string,
    content: string | null | undefined,
    opts: { private?: boolean; source?: string; evidenceRefs?: string[] },
  ) => {
    if (content) {
      const identity = identityFor(layer);
      fragments.push({
        ...identity,
        cluster,
        scope: { kind: 'project', projectId: ctx.conversationId },
        subject: subjectFor(layer, ctx),
        version: 'context-assembly-v1',
        content,
        visibility: opts.private
          ? { kind: 'agent', agentId: opts.source ?? ctx.agentId }
          : { kind: 'team' },
        freshness: { observedAt },
        evidenceRefs: opts.evidenceRefs ?? [],
      });
    }
  };

  const input = { ctx, push };

  renderSystemTier(input);
  renderKnowledgeTier(input);
  renderTaskTier(input);
  renderInteractionTier(input);

  return fragments;
}
