import { resolveTeamRuntime } from '@/lib/team-runtime';
import type { TeamRuntime } from '@/lib/team-runtime';
import { listAgents, parseAgentAccountIds } from '@/server/db/agentQueries';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import type { KanbanSnapshotProvider } from './index';
import type { AgentMentionConfig } from './types-v2';

function mentionConfigForAgent(agent: { id: string; displayName: string }): AgentMentionConfig {
  const patterns = [`@${agent.id}`];
  const displayName = agent.displayName.trim();
  if (displayName && displayName !== agent.id) {
    patterns.push(`@${displayName}`);
  }
  return { id: agent.id, mentionPatterns: patterns };
}

function resolveConversationRuntime(conversationId: string): TeamRuntime {
  const conversation = conversationRepo.getById(conversationId);
  const teamPack = conversation?.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;
  const presetAgents = listAgents().map((agent) => ({
    id: agent.id,
    name: agent.name,
    roleCardId: agent.role_card_id,
    accountIds: parseAgentAccountIds(agent),
    cliEngine: undefined,
    emoji: agent.emoji,
  }));
  const activeAgentIds = teamPack
    ? teamPack.roles.map((role) => role.id)
    : presetAgents.map((agent) => agent.id);

  return resolveTeamRuntime({
    conversationId,
    teamPack,
    presetAgents,
    activeAgentIds,
    roleCards: [],
    skillsMap: {},
    agentSkillIds: {},
    agentAccountOverrides: {},
    agentRoleCardOverrides: {},
  });
}

export function createRuntimeSnapshotProvider(): KanbanSnapshotProvider {
  return {
    getTasks(conversationId) {
      return taskRepo.getByConversation(conversationId);
    },
    getCommunicationPolicy(conversationId) {
      return resolveConversationRuntime(conversationId).communicationPolicy;
    },
    getAgentMentionConfigs(conversationId) {
      return resolveConversationRuntime(conversationId).roster.map((agent) => (
        mentionConfigForAgent({ id: agent.id, displayName: agent.displayName })
      ));
    },
  };
}

