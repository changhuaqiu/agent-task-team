// Invocation Pipeline runtime-profile resolution.
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile, RuntimeSkillSummary, TeamRuntime } from '@/lib/team-runtime';
import { listAccounts } from '../accounts-file';
import { listAgents } from '../db/agentQueries';
import { loadAllRoleCards } from '../db/roleCardQueries';
import { conversationRepo } from '../repositories/conversation-repo';
import { skillRepo } from '../repositories/skill-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';

export interface ConversationRuntimeResolution {
  runtime: TeamRuntime;
  profile: RuntimeAgentProfile | null;
}
function uniqueRoleCards() {
  const cards = new Map(PRESET_ROLE_CARDS.map((card) => [card.id, card]));
  for (const card of loadAllRoleCards()) cards.set(card.id, card);
  return Array.from(cards.values());
}

function skillsMap(): Record<string, RuntimeSkillSummary> {
  return Object.fromEntries(skillRepo.list().map((skill) => [skill.id, {
    id: skill.id,
    name: skill.name,
    description: skill.description ?? undefined,
    version: skill.version,
    config: skill.config ?? undefined,
  }]));
}

export function resolveConversationRuntime(
  conversationId: string,
): TeamRuntime | undefined {
  const conversation = conversationRepo.getById(conversationId);
  if (!conversation) return undefined;

  const teamPack = conversation.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;
  const presetAgents = listAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleCardId: agent.role_card_id,
    emoji: agent.emoji,
  }));
  return resolveTeamRuntime({
    conversationId,
    teamPack,
    presetAgents,
    activeAgentIds: teamPack?.roles.map((role) => role.id) ?? presetAgents.map((agent) => agent.id),
    roleCards: uniqueRoleCards(),
    skillsMap: skillsMap(),
    agentSkillIds: skillRepo.getAllAgentSkillIds(),
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });
}

export function resolveConversationRuntimeProfile(
  conversationId: string,
  agentId: string,
): ConversationRuntimeResolution | undefined {
  const runtime = resolveConversationRuntime(conversationId);
  if (!runtime) return undefined;
  const accounts = listAccounts().map((account) => ({
    id: account.id,
    provider: account.provider,
    enabled: account.enabled,
  }));
  return {
    runtime,
    profile: resolveRuntimeAgentProfile(runtime, agentId, accounts),
  };
}
