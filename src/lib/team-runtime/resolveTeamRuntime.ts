import type {
  RuntimeAgent,
  RuntimeAgentTheme,
  RuntimeCliEngine,
  RuntimeSkillSummary,
  TeamRuntime,
} from './types';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';

const HANDOFF_BLOCK_REASON = '团队协作规则阻止了这次转交';
const DEFAULT_TEAM_AGENT_IDS = ['mario', 'luigi', 'peach', 'dk'];
const DEFAULT_TEAM_REQUIRED_SENDS: Record<string, string[]> = {
  mario: ['luigi', 'peach', 'dk'],
  luigi: ['mario', 'peach'],
  peach: ['mario', 'luigi', 'dk'],
  dk: ['mario', 'luigi', 'peach'],
};

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

function initialAgentId(teamPack: TeamPack | undefined, roster: RuntimeAgent[]): string | null {
  if (!teamPack) return null;
  const availableAgentIds = new Set(roster.map((agent) => agent.id));

  if (teamPack.teamMode === 'pipeline') {
    const roleId = teamPack.workflow.steps?.[0]?.role;
    return roleId && availableAgentIds.has(roleId) ? roleId : null;
  }

  if (teamPack.teamMode === 'parallel') {
    return teamPack.workflow.steps
      ?.map((step) => step.role)
      .find((roleId) => availableAgentIds.has(roleId)) ?? null;
  }

  // hub_spoke and custom both start from the first non-terminal workflow state.
  // Preserve the former runtime fallback for an unknown persisted mode.
  const roleId = teamPack.workflow.states?.find((state) => !state.terminal)?.role;
  return roleId && availableAgentIds.has(roleId) ? roleId : null;
}

function isDefaultHarnessTeam(teamPack: TeamPack): boolean {
  if (teamPack.name === 'default-team') return true;
  const roleIds = new Set(teamPack.roles.map((role) => role.id));
  return DEFAULT_TEAM_AGENT_IDS.every((id) => roleIds.has(id));
}

function explainHandoffBlock(
  teamPack: TeamPack | undefined,
  fromAgentId: string,
  toAgentId: string,
): string | undefined {
  if (!teamPack) return undefined;
  const row = teamPack.communicationMatrix[fromAgentId];
  if (!row) return HANDOFF_BLOCK_REASON;
  const allowed = row.canSendTo.includes(toAgentId)
    || (isDefaultHarnessTeam(teamPack)
      && (DEFAULT_TEAM_REQUIRED_SENDS[fromAgentId]?.includes(toAgentId) ?? false));
  return allowed ? undefined : HANDOFF_BLOCK_REASON;
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
    explainHandoffBlock: (fromAgentId, toAgentId) => explainHandoffBlock(
      input.teamPack,
      fromAgentId,
      toAgentId,
    ),
    initialAgentId: initialAgentId(input.teamPack, orderedRoster),
  };
}
