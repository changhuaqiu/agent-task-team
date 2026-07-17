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
  const { req, roleCard, allRoleCards, runtimeRoster, teamPack, messages, skillSummaries, tools, scenario } = ctx;

  // Capability — skills + tools. Archetype-differentiated (planner omits
  // capability in init/iterate, per injectionPolicy).
  push('capability', 'skill', buildSkillLayer(skillSummaries), { tier: 'tool', importance: 0.6 });
  push('capability', 'tool', buildToolLayer(tools), { tier: 'tool', importance: 0.6 });

  // Team roster — situation awareness. Omitted in wakeup.
  if (scenario !== 'wakeup') {
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
  if (teamPack && scenario !== 'wakeup') {
    push('situation', 'teamPack', buildTeamPackLayer(ctx.agentId, teamPack), { tier: 'project', importance: 0.6, scope: '/project' });
  }

  // History — agent's own trajectory memory. Private.
  // 可见性标签；filterVisible/assertVisibility 强制执行在 P2 接入（见 spec §9）
  push('dialog', 'history', buildHistoryLayer(messages, req.agentId, {
    query: req.rawPrompt,
    limit: 10,
  }), { tier: 'project', importance: 0.3, scope: `/project/${req.agentId}`, private: true });
}
