import type { AgentProfile } from './matcher';
import type { PhaseProposal } from '@/lib/breakdownParser';
import { matchTaskToAgent } from './matcher';

export class DispatchAdvisor {
  private agents: AgentProfile[];

  constructor(agents: AgentProfile[]) {
    this.agents = agents;
  }

  /**
   * Enrich each task with a suggested agentId based on capability matching.
   * Preserves existing agentId if already set.
   */
  suggest(phases: PhaseProposal[], currentLoad: Record<string, number>): PhaseProposal[] {
    return phases.map((phase) => ({
      ...phase,
      tasks: phase.tasks.map((task) => {
        if (task.agentId) return task;
        const ranked = matchTaskToAgent(task, this.agents, currentLoad);
        const best = ranked[0];
        return {
          ...task,
          agentId: best && best.score > 0 ? best.agentId : undefined,
        };
      }),
    }));
  }

  /**
   * Generate a markdown report for embedding in the planner prompt.
   * Shows suggested assignment for each task with reasoning.
   */
  suggestReport(phases: PhaseProposal[], currentLoad: Record<string, number>): string {
    const lines: string[] = ['## 分派建议\n'];

    for (const phase of phases) {
      for (const task of phase.tasks) {
        const ranked = matchTaskToAgent(task, this.agents, currentLoad);
        const best = ranked[0];
        if (task.agentId) {
          lines.push(`- "${task.title}" → @${task.agentId} (已指定)`);
        } else if (best && best.score > 0) {
          lines.push(`- "${task.title}" → @${best.agentId} (${best.reason})`);
        } else {
          lines.push(`- "${task.title}" → 无匹配角色`);
        }
      }
    }

    return lines.join('\n');
  }
}
