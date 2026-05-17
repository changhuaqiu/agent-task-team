export interface TaskGraphPolicyInput {
  action: string;
  actorId?: string;
  confirmed?: boolean;
  taskStatus?: string;
  currentOwnerAgentId?: string;
  nextOwnerAgentId?: string;
}

export interface TaskGraphPolicyDecision {
  allowed: boolean;
  requiresConfirmation: boolean;
  reasonCode?: string;
  message?: string;
}

const HIGH_IMPACT_ACTIONS = new Set(['mergeTasks', 'cancelTask']);

export function evaluateTaskGraphAction(input: TaskGraphPolicyInput): TaskGraphPolicyDecision {
  if (
    input.action === 'assignTask' &&
    input.taskStatus === 'in_progress' &&
    input.currentOwnerAgentId &&
    input.nextOwnerAgentId &&
    input.currentOwnerAgentId !== input.nextOwnerAgentId &&
    input.actorId !== 'user' &&
    input.actorId !== input.currentOwnerAgentId &&
    !input.confirmed
  ) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reasonCode: 'task_graph.ownership_confirmation_required',
      message: '这个任务正在由其他 Agent 执行，改派前需要用户确认。',
    };
  }

  if (HIGH_IMPACT_ACTIONS.has(input.action) && !input.confirmed) {
    return {
      allowed: false,
      requiresConfirmation: true,
      reasonCode: 'task_graph.confirmation_required',
      message: '这个操作会改变任务结构或终止任务，需要用户确认。',
    };
  }

  return {
    allowed: true,
    requiresConfirmation: false,
  };
}
