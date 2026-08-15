import type { TeamPack } from '@/types/teamPack';
import type { WorkflowPolicy } from './types';

function selectInitialAgent(teamPack: TeamPack, availableAgentIds: Set<string>): string | null {
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

export function resolveWorkflowPolicy(teamPack: TeamPack | undefined, availableAgentIds: string[]): WorkflowPolicy {
  const available = new Set(availableAgentIds);
  return {
    selectInitialAgent() {
      if (!teamPack) return null;
      return selectInitialAgent(teamPack, available);
    },
  };
}
