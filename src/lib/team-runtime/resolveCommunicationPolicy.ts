import type { TeamPack } from '@/types/teamPack';
import type { CommunicationPolicy } from './types';

const BLOCK_REASON = '团队协作规则阻止了这次转交';

export function resolveCommunicationPolicy(teamPack?: TeamPack): CommunicationPolicy {
  return {
    canSend(fromAgentId: string, toAgentId: string) {
      if (!teamPack) return true;
      const row = teamPack.communicationMatrix[fromAgentId];
      if (!row) return false;
      return row.canSendTo.includes(toAgentId);
    },
    explainBlock(fromAgentId: string, toAgentId: string) {
      if (this.canSend(fromAgentId, toAgentId)) return undefined;
      return BLOCK_REASON;
    },
  };
}
