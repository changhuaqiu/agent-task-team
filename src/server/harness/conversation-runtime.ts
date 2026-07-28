import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile, RuntimeSkillSummary, TeamRuntime } from '@/lib/team-runtime';
import { listAccounts } from '../accounts-file';
import { listAgents } from '../db/agentQueries';
import { loadAllRoleCards } from '../db/roleCardQueries';
import { conversationRepo } from '../repositories/conversation-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { sessionRepo } from '../repositories/session-repo';
import { skillRepo } from '../repositories/skill-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { resolveFailureAwareRuntimeProfile } from './runtime-profile-recovery';

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

export function resolveConversationRuntimeProfile(
  conversationId: string,
  agentId: string,
  options?: { taskId?: string; isolationKey?: string },
): ConversationRuntimeResolution | undefined {
  const conversation = conversationRepo.getById(conversationId);
  if (!conversation) return undefined;

  const teamPack = conversation.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;
  const presetAgents = listAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleCardId: agent.role_card_id,
    emoji: agent.emoji,
  }));
  const runtime = resolveTeamRuntime({
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
  const accounts = listAccounts().map((account) => ({
    id: account.id,
    provider: account.provider,
    enabled: account.enabled,
  }));
  const activeSession = sessionRepo.findActiveByConversation(
    agentId,
    conversationId,
    options?.isolationKey ?? '',
  );
  return {
    runtime,
    profile: resolveFailureAwareRuntimeProfile({
      runtime,
      agentId,
      accounts,
      invocations: invocationRepo.getByConversation(conversationId),
      taskId: options?.taskId,
      activeSessionId: activeSession?.id,
    }),
  };
}
