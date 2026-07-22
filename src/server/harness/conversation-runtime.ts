import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile, RuntimeSkillSummary, TeamRuntime } from '@/lib/team-runtime';
import { listAccounts } from '../accounts-file';
import { listAgents, parseAgentAccountIds } from '../db/agentQueries';
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

function presetAgents() {
  return listAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleCardId: agent.role_card_id,
    accountIds: parseAgentAccountIds(agent),
    emoji: agent.emoji,
  }));
}

function runtimeAccounts() {
  return listAccounts().map((account) => ({
    id: account.id,
    provider: account.provider,
    enabled: account.enabled,
  }));
}

function resolveServerTeamRuntime(conversationId: string, teamPackId?: string | null): TeamRuntime {
  const teamPack = teamPackId ? teamPackRepo.getById(teamPackId) : undefined;
  const agents = presetAgents();
  return resolveTeamRuntime({
    conversationId,
    teamPack,
    presetAgents: agents,
    activeAgentIds: teamPack?.roles.map((role) => role.id) ?? agents.map((agent) => agent.id),
    roleCards: uniqueRoleCards(),
    skillsMap: skillsMap(),
    agentSkillIds: skillRepo.getAllAgentSkillIds(),
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });
}

export interface TeamRuntimeReadiness {
  ready: boolean;
  missingRoles: Array<{ id: string; displayName: string }>;
  error?: string;
}

export function resolveTeamPackRuntimeReadiness(teamPackId: string): TeamRuntimeReadiness {
  const teamPack = teamPackRepo.getById(teamPackId);
  if (!teamPack) {
    return { ready: false, missingRoles: [], error: '所选 Agent 团队不存在，请重新选择' };
  }
  const runtime = resolveServerTeamRuntime(`team-readiness:${teamPackId}`, teamPackId);
  const accounts = runtimeAccounts();
  const missingRoles = teamPack.roles
    .filter((role) => role.required && !resolveRuntimeAgentProfile(runtime, role.id, accounts))
    .map((role) => ({ id: role.id, displayName: role.displayName }));
  return { ready: missingRoles.length === 0, missingRoles };
}

export function resolveConversationRuntimeProfile(
  conversationId: string,
  agentId: string,
): ConversationRuntimeResolution | undefined {
  const conversation = conversationRepo.getById(conversationId);
  if (!conversation) return undefined;

  const runtime = resolveServerTeamRuntime(conversationId, conversation.team_pack_id);
  return {
    runtime,
    profile: resolveRuntimeAgentProfile(runtime, agentId, runtimeAccounts()),
  };
}
