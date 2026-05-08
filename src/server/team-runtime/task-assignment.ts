import { resolveTeamRuntime } from '@/lib/team-runtime';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

export type TaskAssignmentSource = 'explicit' | 'workflow-policy' | 'runtime-roster' | 'fallback';

export interface ResolveTaskAssignmentInput {
  conversationId: string;
  taskId: string;
  title: string;
  description?: string | null;
  explicitAgentId?: string | null;
  fallbackAgentId?: string | null;
}

export interface ResolvedTaskAssignment {
  agentId?: string;
  source: TaskAssignmentSource;
  reason: string;
}

function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveInitialTaskAssignment(input: ResolveTaskAssignmentInput): ResolvedTaskAssignment {
  const explicitAgentId = present(input.explicitAgentId);
  if (explicitAgentId) {
    return {
      agentId: explicitAgentId,
      source: 'explicit',
      reason: 'Explicit task agent was provided.',
    };
  }

  const conversation = conversationRepo.getById(input.conversationId);
  const teamPack = conversation?.team_pack_id ? teamPackRepo.getById(conversation.team_pack_id) : undefined;

  if (teamPack) {
    const runtime = resolveTeamRuntime({
      conversationId: input.conversationId,
      teamPack,
      presetAgents: [],
      activeAgentIds: teamPack.roles.map((role) => role.id),
      roleCards: [],
      skillsMap: {},
      agentSkillIds: {},
      agentAccountOverrides: {},
      agentRoleCardOverrides: {},
    });

    const assignment = runtime.workflowPolicy.assignInitialTask({
      id: input.taskId,
      description: input.description ?? input.title,
      status: 'pending',
    });
    if (assignment?.agentId) {
      return {
        agentId: assignment.agentId,
        source: 'workflow-policy',
        reason: 'Team workflow policy selected the initial assignee.',
      };
    }

    const rosterAgentId = runtime.roster[0]?.id;
    if (rosterAgentId) {
      return {
        agentId: rosterAgentId,
        source: 'runtime-roster',
        reason: 'Team workflow did not assign; fell back to the first runtime role.',
      };
    }
  }

  return {
    agentId: present(input.fallbackAgentId),
    source: 'fallback',
    reason: 'No workflow assignment was available.',
  };
}
