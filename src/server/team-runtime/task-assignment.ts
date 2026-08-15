import { resolveTeamRuntime } from '@/lib/team-runtime';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

interface ResolveInitialTaskAgentInput {
  conversationId: string;
  explicitAgentId?: string | null;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveInitialTaskAgentId(input: ResolveInitialTaskAgentInput): string | undefined {
  const explicitAgentId = present(input.explicitAgentId);
  if (explicitAgentId) return explicitAgentId;

  const conversation = conversationRepo.getById(input.conversationId);
  const teamPack = conversation?.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;

  if (teamPack) {
    const runtime = resolveTeamRuntime({
      conversationId: input.conversationId,
      teamPack,
      presetAgents: [],
      activeAgentIds: teamPack.roles.map((role) => role.id),
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    if (runtime.initialAgentId) return runtime.initialAgentId;

    const rosterAgentId = runtime.roster[0]?.id;
    if (rosterAgentId) return rosterAgentId;
  }

  return undefined;
}
