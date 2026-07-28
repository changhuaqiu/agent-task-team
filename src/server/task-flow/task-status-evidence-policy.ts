import { conversationRepo } from '../repositories/conversation-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import type { TaskRow, TaskStatus } from '../repositories/task-repo';
import {
  evaluateTaskStatusEvidenceGate,
  hasCurrentVerifiedMerge,
  type TaskGateEvidenceDecision,
} from './task-gate-evidence';

/**
 * Pure admission policy for direct Task status commands.
 *
 * This validates evidence but deliberately does not create QualityGates,
 * append proofs, or mutate Task state. Review/verification Gate creation is
 * coordinated by the Delivery Control Process Manager, and the Task owner
 * performs the actual transition.
 */
export class TaskStatusEvidencePolicy {
  evaluate(input: {
    task: TaskRow;
    nextStatus: TaskStatus;
    evidence: unknown;
    actor: { type: 'user' | 'agent' | 'system'; id: string };
  }): TaskGateEvidenceDecision {
    const actions = taskGraphRepo.listActionsForTask(input.task.id);
    const pullRequestRequired = Boolean(
      conversationRepo.getById(input.task.conversation_id)?.git_repo_root,
    );
    const decision = evaluateTaskStatusEvidenceGate({
      task: input.task,
      nextStatus: input.nextStatus,
      actorId: input.actor.id,
      evidence: input.evidence,
      pullRequestRequired,
      verifiedPullRequest: actions.some((action) => action.type === 'task.pull_request_submitted'),
      verifiedMerge: hasCurrentVerifiedMerge(actions),
    });
    return decision;
  }
}

export const taskStatusEvidencePolicy = new TaskStatusEvidencePolicy();
