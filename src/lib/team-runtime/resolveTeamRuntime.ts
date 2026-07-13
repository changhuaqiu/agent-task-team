import type {
  RuntimeAgent,
  RuntimeAgentTheme,
  RuntimeCliEngine,
  RuntimeSkillSummary,
  TeamRuntime,
} from './types';
import { resolveCommunicationPolicy } from './resolveCommunicationPolicy';
import { resolveWorkflowPolicy } from './resolveWorkflowPolicy';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';

export interface PresetRuntimeAgentInput {
  id: string;
  name: string;
  roleCardId: string;
  accountIds?: string[];
  cliEngine?: RuntimeCliEngine;
  emoji?: string;
  theme?: RuntimeAgentTheme;
}

export interface ResolveTeamRuntimeInput {
  conversationId: string;
  teamPack?: TeamPack;
  presetAgents: PresetRuntimeAgentInput[];
  activeAgentIds: string[];
  roleCards: RoleCard[];
  skillsMap: Record<string, RuntimeSkillSummary>;
  agentSkillIds: Record<string, string[]>;
  agentAccountOverrides: Record<string, string[]>;
  agentRoleCardOverrides: Record<string, string>;
}

function skillsFromIds(ids: string[] | undefined, skillsMap: Record<string, RuntimeSkillSummary>): RuntimeSkillSummary[] {
  return Array.from(new Set(ids ?? [])).map((id) => skillsMap[id]).filter(Boolean);
}

function roleCardById(roleCards: RoleCard[], id: string | undefined): RoleCard | undefined {
  if (!id) return undefined;
  return roleCards.find((card) => card.id === id);
}

function presetRuntimeAgent(agent: PresetRuntimeAgentInput, input: ResolveTeamRuntimeInput): RuntimeAgent {
  const roleCardId = input.agentRoleCardOverrides[agent.id] ?? agent.roleCardId;
  const roleCard = roleCardById(input.roleCards, roleCardId);
  const accountIds = roleCard?.accountIds?.length
    ? roleCard.accountIds
    : (input.agentAccountOverrides[agent.id] ?? agent.accountIds ?? []);
  return {
    id: agent.id,
    displayName: roleCard?.displayName ?? agent.name,
    source: 'preset-agent',
    roleCardId,
    roleCard,
    accountIds,
    skills: skillsFromIds(input.agentSkillIds[agent.id], input.skillsMap),
    cliEngine: agent.cliEngine,
    emoji: agent.emoji,
    theme: agent.theme,
  };
}

const ROLE_EMOJI_HINTS: Array<[RegExp, string]> = [
  [/planner|plan|统筹|规划/, '🎯'],
  [/coder|developer|开发|实现/, '💻'],
  [/frontend|前端|ui/, '🎨'],
  [/backend|后端/, '🛠️'],
  [/review|评审|审查/, '🔍'],
  [/arch|架构/, '🏛️'],
  [/qa|test|测试|验收/, '🧪'],
  [/research|研究/, '🔬'],
  [/analyst|分析/, '📊'],
  [/writer|写作/, '✍️'],
];

function emojiForRole(role: { id: string; displayName?: string }): string {
  const text = `${role.id} ${role.displayName ?? ''}`.toLowerCase();
  return ROLE_EMOJI_HINTS.find(([re]) => re.test(text))?.[1] ?? '🤖';
}

function teamRoleRuntimeAgents(input: ResolveTeamRuntimeInput): RuntimeAgent[] {
  const teamPack = input.teamPack;
  if (!teamPack) return [];
  return teamPack.roles.map((role) => {
    const overrideRoleCardId = input.agentRoleCardOverrides[role.id];
    const roleCardId = overrideRoleCardId ?? role.roleCardId;
    const globalRoleCard = roleCardById(input.roleCards, roleCardId);
    const roleCard = role.roleCardSnapshot
      ? {
          ...role.roleCardSnapshot,
          id: `team-role-snapshot-${role.id}`,
          isPreset: false,
          version: role.roleCardSnapshot.snapshotVersion,
          createdAt: role.roleCardSnapshot.snapshottedAt,
          updatedAt: role.roleCardSnapshot.snapshottedAt,
        }
      : globalRoleCard;
    const accountIds = role.accountIds?.length
      ? role.accountIds
      : roleCard?.accountIds?.length
        ? roleCard.accountIds
        : (input.agentAccountOverrides[role.id] ?? []);

    return {
      id: role.id,
      displayName: roleCard?.displayName ?? role.displayName,
      source: 'team-pack-role',
      roleCardId: roleCard?.id ?? roleCardId,
      roleCard,
      accountIds,
      skills: skillsFromIds([...(role.skillIds ?? []), ...(input.agentSkillIds[role.id] ?? [])], input.skillsMap),
      emoji: emojiForRole(role),
    };
  });
}

export function resolveTeamRuntime(input: ResolveTeamRuntimeInput): TeamRuntime {
  const roster = input.teamPack
    ? teamRoleRuntimeAgents(input)
    : input.presetAgents.map((agent) => presetRuntimeAgent(agent, input));

  const active = new Set(input.activeAgentIds);
  const orderedRoster = [
    ...roster.filter((agent) => active.has(agent.id)),
    ...roster.filter((agent) => !active.has(agent.id)),
  ];

  return {
    conversationId: input.conversationId,
    teamPack: input.teamPack,
    roster: orderedRoster,
    communicationPolicy: resolveCommunicationPolicy(input.teamPack),
    workflowPolicy: resolveWorkflowPolicy(input.teamPack, orderedRoster.map((agent) => agent.id)),
  };
}
