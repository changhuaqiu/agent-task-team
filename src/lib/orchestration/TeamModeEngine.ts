// src/lib/orchestration/TeamModeEngine.ts

import type { TeamPack, Task } from '@/types/teamPack';

export type TeamModeType = 'pipeline' | 'parallel' | 'hub_spoke' | 'custom';

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  roleId: string;
  assignedAt: string;
}

export interface TeamModeStrategy {
  mode: TeamModeType;
  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null;
  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null;
  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean;
}

export class TeamModeEngine {
  private strategies: Map<TeamModeType, TeamModeStrategy>;

  constructor() {
    this.strategies = new Map();
    this.strategies.set('pipeline', new PipelineStrategy());
    this.strategies.set('parallel', new ParallelStrategy());
    this.strategies.set('hub_spoke', new HubSpokeStrategy());
    this.strategies.set('custom', new CustomStateMachineStrategy());
  }

  getStrategy(teamPack: TeamPack): TeamModeStrategy {
    return this.strategies.get(teamPack.teamMode) ?? new HubSpokeStrategy();
  }

  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null {
    const strategy = this.getStrategy(teamPack);
    return strategy.assignTask(task, teamPack, availableAgents);
  }

  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null {
    const strategy = this.getStrategy(teamPack);
    return strategy.getNextRole(currentRoleId, taskResult, teamPack, availableAgents);
  }

  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean {
    const strategy = this.getStrategy(teamPack);
    return strategy.canCommunicate(fromRoleId, toRoleId, teamPack);
  }
}

// ──────────────────────────────────────────────
// Pipeline Strategy
// ──────────────────────────────────────────────

class PipelineStrategy implements TeamModeStrategy {
  mode: 'pipeline' = 'pipeline';

  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null {
    const firstStep = teamPack.workflow.steps?.[0];
    if (!firstStep || !availableAgents.includes(firstStep.role)) {
      return null; // No agent available for first role
    }
    return {
      taskId: task.id,
      agentId: firstStep.role,
      roleId: firstStep.role,
      assignedAt: new Date().toISOString(),
    };
  }

  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null {
    const steps = teamPack.workflow.steps ?? [];
    const currentIndex = steps.findIndex(s => s.role === currentRoleId);
    if (currentIndex === -1 || currentIndex === steps.length - 1) {
      return null; // Last step, task done
    }
    const nextRole = steps[currentIndex + 1].role;
    return availableAgents.includes(nextRole) ? nextRole : null;
  }

  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean {
    const matrix = teamPack.communicationMatrix[fromRoleId];
    const fromRow = teamPack.roles.find(r => r.id === fromRoleId);
    const toRow = teamPack.roles.find(r => r.id === toRoleId);

    // In pipeline, roles can only communicate with immediate neighbors
    if (!fromRow || !toRow) return false;
    const steps = teamPack.workflow.steps ?? [];
    const fromIndex = steps.findIndex(s => s.role === fromRoleId);
    const toIndex = steps.findIndex(s => s.role === toRoleId);
    return Math.abs(fromIndex - toIndex) === 1;
  }
}

// ──────────────────────────────────────────────
// Parallel Strategy
// ──────────────────────────────────────────────

class ParallelStrategy implements TeamModeStrategy {
  mode: 'parallel' = 'parallel';

  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null {
    const steps = teamPack.workflow.steps ?? [];
    // All parallel roles get the task (coordinator sends to all)
    const parallelRoles = steps.map(s => s.role).filter(id => availableAgents.includes(id));

    if (parallelRoles.length === 0) return null;

    return {
      taskId: task.id,
      agentId: parallelRoles[0], // First available parallel agent
      roleId: parallelRoles[0],
      assignedAt: new Date().toISOString(),
    };
  }

  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null {
    // In parallel, all return to coordinator for aggregation
    const firstStep = teamPack.workflow.steps?.[0];
    if (!firstStep) return null;
    const coordinatorId = firstStep.role;
    return availableAgents.includes(coordinatorId) ? coordinatorId : null;
  }

  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean {
    const matrix = teamPack.communicationMatrix[fromRoleId];
    const canSend = matrix?.canSendTo.includes(toRoleId) ?? false;
    return canSend;
  }
}

// ──────────────────────────────────────────────
// Hub-Spoke Strategy
// ──────────────────────────────────────────────

class HubSpokeStrategy implements TeamModeStrategy {
  mode: 'hub_spoke' = 'hub_spoke';

  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null {
    const initialState = teamPack.workflow.states?.find(s => !s.terminal);
    if (!initialState || !availableAgents.includes(initialState.role)) {
      return null; // Hub not available
    }
    return {
      taskId: task.id,
      agentId: initialState.role,
      roleId: initialState.role,
      assignedAt: new Date().toISOString(),
    };
  }

  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null {
    // Hub can choose any next role based on decision
    const matrix = teamPack.communicationMatrix[currentRoleId];
    if (!matrix) return null;

    // Default to first available escalation target
    return matrix.canEscalateTo?.find(id => availableAgents.includes(id)) ?? null;
  }

  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean {
    const matrix = teamPack.communicationMatrix[fromRoleId];
    const canSend = matrix?.canSendTo.includes(toRoleId) ?? false;
    return canSend;
  }
}

// ──────────────────────────────────────────────
// Custom State Machine Strategy
// ──────────────────────────────────────────────

class CustomStateMachineStrategy implements TeamModeStrategy {
  mode: 'custom' = 'custom';

  assignTask(task: Task, teamPack: TeamPack, availableAgents: string[]): TaskAssignment | null {
    const states = teamPack.workflow.states ?? [];
    const initialState = states.find(s => !s.terminal);
    if (!initialState) return null;

    const initialStateRole = initialState.role;
    if (!availableAgents.includes(initialStateRole)) {
      return null;
    }

    return {
      taskId: task.id,
      agentId: initialStateRole,
      roleId: initialStateRole,
      assignedAt: new Date().toISOString(),
    };
  }

  getNextRole(currentRoleId: string, taskResult: any, teamPack: TeamPack, availableAgents: string[]): string | null {
    const states = teamPack.workflow.states ?? [];
    const currentState = states.find(s => s.role === currentRoleId);
    if (!currentState) return null;
    if (currentState.terminal) return null;

    // Check transitions
    const transitions = currentState.transitions ?? [];
    for (const transition of transitions) {
      if (transition.to && availableAgents.includes(transition.to)) {
        return transition.to;
      }
    }
    return null;
  }

  canCommunicate(fromRoleId: string, toRoleId: string, teamPack: TeamPack): boolean {
    const matrix = teamPack.communicationMatrix[fromRoleId];
    const canSend = matrix?.canSendTo.includes(toRoleId) ?? false;
    return canSend;
  }
}

export default TeamModeEngine;
