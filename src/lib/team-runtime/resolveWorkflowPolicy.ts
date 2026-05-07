import { TeamModeEngine } from '@/lib/orchestration/TeamModeEngine';
import type { TeamPack } from '@/types/teamPack';
import type { WorkflowPolicy } from './types';

export function resolveWorkflowPolicy(teamPack: TeamPack | undefined, availableAgentIds: string[]): WorkflowPolicy {
  return {
    assignInitialTask(task) {
      if (!teamPack) return null;
      const engine = new TeamModeEngine();
      return engine.assignTask(
        {
          id: task.id,
          description: task.description ?? '',
          status: task.status === 'done' ? 'completed' : 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        teamPack,
        availableAgentIds,
      );
    },
    getNextAgent(currentAgentId, taskResult) {
      if (!teamPack) return null;
      const engine = new TeamModeEngine();
      return engine.getNextRole(currentAgentId, taskResult, teamPack, availableAgentIds);
    },
  };
}
