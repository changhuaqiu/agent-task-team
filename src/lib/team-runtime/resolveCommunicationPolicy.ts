import type { TeamPack } from '@/types/teamPack';
import type { CommunicationPolicy } from './types';

const BLOCK_REASON = '团队协作规则阻止了这次转交';
const DEFAULT_TEAM_AGENT_IDS = ['mario', 'luigi', 'toad', 'peach', 'dk', 'yoshi'];
const DEFAULT_TEAM_REQUIRED_SENDS: Record<string, string[]> = {
  mario: ['luigi', 'toad', 'peach', 'dk', 'yoshi'],
  luigi: ['mario', 'toad', 'peach', 'yoshi'],
  toad: ['mario', 'luigi', 'peach', 'dk', 'yoshi'],
  peach: ['mario', 'luigi', 'toad', 'dk', 'yoshi'],
  dk: ['mario', 'luigi', 'toad', 'peach'],
  yoshi: ['mario', 'luigi', 'toad', 'peach', 'dk'],
};

function isDefaultHarnessTeam(teamPack: TeamPack): boolean {
  if (teamPack.name === 'default-team') return true;
  const roleIds = new Set(teamPack.roles.map((role) => role.id));
  return DEFAULT_TEAM_AGENT_IDS.every((id) => roleIds.has(id));
}

function canSendFromMatrix(teamPack: TeamPack, fromAgentId: string, toAgentId: string): boolean {
  const row = teamPack.communicationMatrix[fromAgentId];
  if (!row) return false;
  if (row.canSendTo.includes(toAgentId)) return true;
  if (!isDefaultHarnessTeam(teamPack)) return false;
  return DEFAULT_TEAM_REQUIRED_SENDS[fromAgentId]?.includes(toAgentId) ?? false;
}

function getEscalationTargetFromMatrix(teamPack: TeamPack, fromAgentId: string, blockedToAgentId?: string): string | undefined {
  const row = teamPack.communicationMatrix[fromAgentId];
  const candidates = row?.canEscalateTo?.filter((agentId) => agentId !== 'human' && agentId !== fromAgentId && agentId !== blockedToAgentId) ?? [];
  if (candidates.length > 0) return candidates[0];

  if (isDefaultHarnessTeam(teamPack) && fromAgentId !== 'mario' && blockedToAgentId !== 'mario') {
    return 'mario';
  }

  return undefined;
}

export function resolveCommunicationPolicy(teamPack?: TeamPack): CommunicationPolicy {
  return {
    canSend(fromAgentId: string, toAgentId: string) {
      if (!teamPack) return true;
      return canSendFromMatrix(teamPack, fromAgentId, toAgentId);
    },
    explainBlock(fromAgentId: string, toAgentId: string) {
      if (this.canSend(fromAgentId, toAgentId)) return undefined;
      return BLOCK_REASON;
    },
    getEscalationTarget(fromAgentId: string, blockedToAgentId?: string) {
      if (!teamPack) return undefined;
      return getEscalationTargetFromMatrix(teamPack, fromAgentId, blockedToAgentId);
    },
  };
}
