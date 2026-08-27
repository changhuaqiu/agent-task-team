import type {
  RuntimeAgent,
  RuntimeAgentTheme,
  RuntimeCliEngine,
  RuntimeSkillSummary,
  TeamRuntime,
} from './types';
import type { TeamPack } from '@/types/teamPack';
import type { AgentResponsibility } from '@/shared/agent-definition';

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
  accountIds?: string[];
  cliEngine?: RuntimeCliEngine;
  instructions?: string;
  responsibility?: AgentResponsibility;
  model?: string;
  emoji?: string;
  theme?: RuntimeAgentTheme;
  skillIds?: string[];
  canModifyCode?: boolean;
  canReview?: boolean;
}

export interface ResolveTeamRuntimeInput {
  conversationId: string;
  teamPack?: TeamPack;
  presetAgents: PresetRuntimeAgentInput[];
  activeAgentIds: string[];
  skillsMap: Record<string, RuntimeSkillSummary>;
  strictActiveRoster?: boolean;
}

function skillsFromIds(ids: string[] | undefined, skillsMap: Record<string, RuntimeSkillSummary>): RuntimeSkillSummary[] {
  return Array.from(new Set(ids ?? [])).map((id) => skillsMap[id]).filter(Boolean);
}

function presetRuntimeAgent(agent: PresetRuntimeAgentInput, input: ResolveTeamRuntimeInput): RuntimeAgent {
  return {
    id: agent.id,
    displayName: agent.name,
    source: 'preset-agent',
    accountIds: agent.accountIds ?? [],
    skills: skillsFromIds(agent.skillIds, input.skillsMap),
    cliEngine: agent.cliEngine,
    instructions: agent.instructions,
    responsibility: agent.responsibility ?? 'specialist',
    model: agent.model,
    emoji: agent.emoji,
    theme: agent.theme,
    canModifyCode: agent.canModifyCode,
    canReview: agent.canReview,
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
  return teamPack.roles.flatMap((role) => {
    const baseAgent = input.presetAgents.find((agent) => agent.id === role.id);
    if (!baseAgent) {
      // A Team is only a set of Agent references. Missing Agent Definitions
      // cannot be synthesized from stale Team snapshots at execution time.
      return [];
    }
    return [{
      id: role.id,
      displayName: baseAgent.name,
      source: 'team-pack-role',
      accountIds: baseAgent.accountIds ?? [],
      skills: skillsFromIds(baseAgent.skillIds, input.skillsMap),
      cliEngine: baseAgent.cliEngine,
      instructions: baseAgent.instructions,
      responsibility: baseAgent.responsibility ?? 'specialist',
      model: baseAgent.model,
      emoji: baseAgent.emoji ?? emojiForRole(role),
      theme: baseAgent.theme,
      canModifyCode: baseAgent.canModifyCode,
      canReview: baseAgent.canReview,
    }];
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
  const teamAgentIds = new Set(teamPack.roles.map((role) => role.id));
  if (!teamAgentIds.has(fromAgentId) || !teamAgentIds.has(toAgentId)) return undefined;
  const row = teamPack.communicationMatrix[fromAgentId];
  if (!row) return HANDOFF_BLOCK_REASON;
  const allowed = row.canSendTo.includes(toAgentId)
    || (isDefaultHarnessTeam(teamPack)
      && (DEFAULT_TEAM_REQUIRED_SENDS[fromAgentId]?.includes(toAgentId) ?? false));
  return allowed ? undefined : HANDOFF_BLOCK_REASON;
}

export function resolveTeamRuntime(input: ResolveTeamRuntimeInput): TeamRuntime {
  const active = new Set(input.activeAgentIds);
  const teamRoster = input.teamPack ? teamRoleRuntimeAgents(input) : [];
  const teamAgentIds = new Set(teamRoster.map((agent) => agent.id));
  const roster = input.teamPack
    ? [
        ...(input.strictActiveRoster ? teamRoster.filter((agent) => active.has(agent.id)) : teamRoster),
        ...input.presetAgents
          .filter((agent) => (!input.strictActiveRoster || active.has(agent.id)) && !teamAgentIds.has(agent.id))
          .map((agent) => presetRuntimeAgent(agent, input)),
      ]
    : input.presetAgents
      .filter((agent) => !input.strictActiveRoster || active.has(agent.id))
      .map((agent) => presetRuntimeAgent(agent, input));
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
