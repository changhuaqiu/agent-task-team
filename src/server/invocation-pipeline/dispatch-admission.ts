import type { ContextArchetype } from '@/lib/agent-context/injectionPolicy';
import type { ContextScenario } from '@/lib/agent-context/scenarioResolver';
import type { RuntimeAgent } from '@/lib/team-runtime';
import type { TaskRow } from '@/server/repositories/task-repo';
import type { AgentActivationCommand } from './types';
import type { AgentResponsibility } from '@/shared/agent-definition';

export type DispatchKind = 'planning' | 'execution' | 'review' | 'verification' | 'recovery' | 'closure';

export interface DispatchRoleSnapshot {
  definitionId: string;
  definitionRevision: number;
  name: string;
  responsibility: AgentResponsibility;
  instructions: string;
  capabilities: {
    canModifyCode: boolean;
    canReview: boolean;
  };
}

export interface DispatchAdmissionGrant {
  kind: DispatchKind;
  contextScenario: ContextScenario;
  archetype: ContextArchetype;
  role: DispatchRoleSnapshot;
  allowCodeChanges: boolean;
  reasonCode: string;
  taskAuthority?: { taskId: string; ownerAgentId: string; revision: number };
}

export type DispatchAdmissionResult =
  | { ok: true; grant: DispatchAdmissionGrant }
  | {
      ok: false;
      reasonCode: 'dispatch_task_assignment_required' | 'dispatch_agent_capability_mismatch' | 'dispatch_subject_invalid';
      message: string;
    };

interface DispatchAdmissionInput {
  trigger: AgentActivationCommand;
  task?: Pick<TaskRow, 'id' | 'status' | 'agent_id' | 'revision'>;
  agent: Pick<RuntimeAgent, 'id' | 'displayName' | 'instructions' | 'responsibility' | 'canModifyCode' | 'canReview'>;
  definitionRevision: number;
}

const REVIEW_SIGNAL = /(?:评审|审查|复核|质量|架构|review|audit|inspect|verify)/iu;

function responsibilityFor(input: DispatchAdmissionInput['agent']): DispatchRoleSnapshot['responsibility'] {
  return input.responsibility ?? 'specialist';
}

function roleSnapshot(
  input: DispatchAdmissionInput,
  responsibility: DispatchRoleSnapshot['responsibility'],
): DispatchRoleSnapshot {
  return {
    definitionId: input.agent.id,
    definitionRevision: input.definitionRevision,
    name: input.agent.displayName,
    responsibility,
    instructions: input.agent.instructions?.trim() ?? '',
    capabilities: {
      canModifyCode: Boolean(input.agent.canModifyCode),
      canReview: Boolean(input.agent.canReview),
    },
  };
}

function grant(
  input: DispatchAdmissionInput,
  responsibility: DispatchRoleSnapshot['responsibility'],
  kind: DispatchKind,
  reasonCode: string,
): DispatchAdmissionResult {
  const contextScenario: ContextScenario = kind === 'planning'
    ? 'planning'
    : kind === 'review'
      ? 'code_review'
      : kind === 'verification'
        ? 'verification'
        : kind === 'execution' && input.trigger.source === 'workflow'
          ? 'wakeup'
          : kind;
  return {
    ok: true,
    grant: {
      kind,
      contextScenario,
      archetype: responsibility === 'coordinator'
        ? 'planner'
        : responsibility === 'reviewer'
          ? 'reviewer'
          : 'worker',
      role: roleSnapshot(input, responsibility),
      allowCodeChanges: kind === 'execution' && Boolean(input.agent.canModifyCode),
      reasonCode,
      ...(input.task ? {
        taskAuthority: {
          taskId: input.task.id,
          ownerAgentId: input.task.agent_id,
          revision: input.task.revision,
        },
      } : {}),
    },
  };
}

/**
 * The single execution-admission seam. Callers provide facts; this Module owns
 * role, task-possession, stage and code-mutation decisions.
 */
export function admitDispatch(input: DispatchAdmissionInput): DispatchAdmissionResult {
  const responsibility = responsibilityFor(input.agent);
  const explicitScenario = input.trigger.contextScenario;

  if (input.trigger.executionSubject && !input.trigger.executionSubject.id.trim()) {
    return {
      ok: false,
      reasonCode: 'dispatch_subject_invalid',
      message: 'Ad-hoc execution subject id is required',
    };
  }

  if (input.trigger.executionMode === 'outcome_recovery' || explicitScenario === 'recovery') {
    return grant(input, responsibility, 'recovery', 'dispatch_recovery_contract');
  }
  if (explicitScenario === 'closure') {
    return grant(input, responsibility, 'closure', 'dispatch_closure_contract');
  }
  if (input.trigger.source === 'review_gate' || explicitScenario === 'code_review') {
    return input.agent.canReview
      ? grant(input, responsibility, 'review', 'dispatch_review_gate')
      : {
          ok: false,
          reasonCode: 'dispatch_agent_capability_mismatch',
          message: `Agent ${input.agent.id} is not authorized to review`,
        };
  }
  if (input.trigger.source === 'test_gate' || explicitScenario === 'verification') {
    return input.agent.canReview
      ? grant(input, responsibility, 'verification', 'dispatch_verification_gate')
      : {
          ok: false,
          reasonCode: 'dispatch_agent_capability_mismatch',
          message: `Agent ${input.agent.id} is not authorized to verify`,
        };
  }
  if (explicitScenario === 'planning' || explicitScenario === 'goal_intake') {
    return grant(input, responsibility, 'planning', 'dispatch_explicit_planning');
  }

  // Coordinators can always receive the request, but ordinary chat/A2A text
  // cannot silently upgrade them into implementers.
  if (responsibility === 'coordinator') {
    return grant(input, responsibility, 'planning', 'dispatch_coordinator_planning');
  }

  if (input.task) {
    const ownerId = input.task.agent_id.trim();
    if (!ownerId || ownerId !== input.agent.id) {
      return {
        ok: false,
        reasonCode: 'dispatch_task_assignment_required',
        message: ownerId
          ? `Task ${input.task.id} is assigned to ${ownerId}, not ${input.agent.id}`
          : `Task ${input.task.id} must be assigned before implementation`,
      };
    }
  }

  if (responsibility === 'reviewer') {
    return REVIEW_SIGNAL.test(input.trigger.prompt)
      ? grant(input, responsibility, 'review', 'dispatch_direct_review')
      : grant(input, responsibility, 'planning', 'dispatch_reviewer_advisory');
  }

  if (!input.agent.canModifyCode) {
    return grant(input, responsibility, 'planning', 'dispatch_read_only_specialist');
  }

  if (!input.task && input.trigger.executionSubject?.kind !== 'ad_hoc_execution') {
    return grant(input, responsibility, 'planning', 'dispatch_unbound_request_planning');
  }

  return grant(
    input,
    responsibility,
    'execution',
    input.task ? 'dispatch_task_owner_execution' : 'dispatch_explicit_ad_hoc_execution',
  );
}
