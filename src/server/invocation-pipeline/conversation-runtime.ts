// Invocation Pipeline runtime-profile resolution.
import { resolveRuntimeAgentProfile, resolveTeamRuntime } from '@/lib/team-runtime';
import type { RuntimeAgentProfile, RuntimeSkillSummary, TeamRuntime } from '@/lib/team-runtime';
import { listAccounts } from '../accounts-file';
import { hasCredential } from '../credentials';
import { listAgents } from '../db/agentQueries';
import { conversationRepo } from '../repositories/conversation-repo';
import { skillRepo } from '../repositories/skill-repo';
import { teamPackRepo } from '../repositories/team-pack-repo';
import { projectAgentMembershipRepo } from '../repositories/project-agent-membership-repo';

export interface ConversationRuntimeResolution {
  runtime: TeamRuntime;
  profile: RuntimeAgentProfile | null;
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
  const projectAgentIds = projectAgentMembershipRepo.listAgentIdsByConversation(conversationId);
  const agentSkillIds = skillRepo.getAllAgentSkillIds();
  const presetAgents = listAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji,
    cliEngine: agent.runtime_id ?? undefined,
    accountIds: (() => {
      try {
        const parsed = JSON.parse(agent.account_ids) as unknown;
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
      } catch {
        return [];
      }
    })(),
    instructions: agent.instructions,
    responsibility: agent.responsibility,
    model: agent.model ?? undefined,
    skillIds: agentSkillIds[agent.id] ?? [],
    canModifyCode: Boolean(agent.can_modify_code),
    canReview: Boolean(agent.can_review),
  }));
  return resolveTeamRuntime({
    conversationId,
    teamPack,
    presetAgents,
    activeAgentIds: conversation.project_id
      ? projectAgentIds
      : teamPack?.roles.map((role) => role.id) ?? presetAgents.map((agent) => agent.id),
    strictActiveRoster: Boolean(conversation.project_id),
    skillsMap: skillsMap(),
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
    authMode: account.authMode,
    enabled: account.enabled,
    status: account.status,
    baseUrl: account.baseUrl,
    models: account.models,
    hasApiKey: hasCredential(account.id),
  }));
  return {
    runtime,
    profile: resolveRuntimeAgentProfile(runtime, agentId, accounts),
  };
}
