// src/lib/agent-context/tiers/knowledgeTier.ts
//
// Knowledge tier — what the agent knows: capability (skill/tool), the
// team roster, the team-pack, and conversation memory (history).
//
// Capability parts carry tier='tool' (rarely trimmed, archetype-specific);
// roster/teamPack/history carry tier='project' with moderate importance.
// History is private to this agent (scope=/project/<agentId>).

import { buildSkillLayer } from '../layers/skillLayer';
import { buildToolLayer } from '../layers/toolLayer';
import { buildTeamLayer } from '../layers/teamLayer';
import { buildTeamPackLayer } from '../layers/teamPackLayer';
import { buildHistoryLayer } from '../layers/historyLayer';
import type { TierRenderInput } from './tierContext';

export function renderKnowledgeTier({ ctx, push }: TierRenderInput): void {
  const { req, allRoleCards, runtimeRoster, teamPack, messages, skillSummaries, tools } = ctx;

  // Capability — bound skills are scenario-invariant so required delivery can
  // be proven; tools share the same capability cluster.
  for (const skill of skillSummaries) {
    const layerId = skill.id ?? skill.name;
    push('capability', `skill:${layerId}`, buildSkillLayer([skill]), { tier: 'tool', importance: 0.6 });
  }
  push('capability', 'tool', buildToolLayer(tools), { tier: 'tool', importance: 0.6 });

  // Team roster — situation awareness. Omitted in wakeup.
  {
    const runtimeTeam = runtimeRoster?.length
      ? [
          '## 当前团队',
          ...runtimeRoster.map((member) => {
            const marker = member.id === ctx.agentId ? '（当前角色）' : '';
            return `- ${member.displayName} @${member.id}${marker}`;
          }),
        ].join('\n')
      : '';
    const team = runtimeRoster !== undefined
      ? runtimeTeam
      : buildTeamLayer(ctx.agentId, allRoleCards ?? [], undefined);
    push('situation', 'team', team, { tier: 'project', importance: 0.5, scope: '/project' });
  }

  // Team-pack context. Omitted in wakeup.
  if (teamPack) {
    push('situation', 'teamPack', buildTeamPackLayer(ctx.agentId, teamPack), { tier: 'project', importance: 0.6, scope: '/project' });
  }

  // History — agent's own trajectory memory. Private to this agent.
  push('dialog', 'history', buildHistoryLayer(messages, req.agentId, {
    query: req.rawPrompt,
    limit: 10,
  }), { tier: 'project', importance: 0.3, scope: `/project/${req.agentId}`, private: true, source: req.agentId });
}
