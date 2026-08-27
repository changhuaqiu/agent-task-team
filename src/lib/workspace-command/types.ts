import type { GoalContract } from '@/server/autonomous-delivery/types';

export interface WorkspaceCommandActor {
  type: 'user';
  id: string;
}

interface WorkspaceCommandBase {
  idempotencyKey: string;
  projectPath: string;
  deliveryId: string;
  actor: WorkspaceCommandActor;
  issuedAt: string;
}

export interface CreateDeliveryCommand extends WorkspaceCommandBase {
  type: 'delivery.create';
  title: string;
  goal: string;
  priority: 'p0' | 'p1' | 'p2' | 'p3';
  teamPackId?: string;
  useWorktree?: boolean;
  gitRepoRoot?: string;
  autonomous: boolean;
  contract?: GoalContract;
}

export interface DeleteDeliveryCommand extends WorkspaceCommandBase {
  type: 'delivery.delete';
}

export interface AdvanceDeliveryCommand extends WorkspaceCommandBase {
  type: 'delivery.advance';
  runId: string;
}

export interface MaterializeDeliveryBreakdownCommand extends WorkspaceCommandBase {
  type: 'delivery.breakdown.materialize';
  projectName: string;
  projectGoal: string;
  tasks: Array<{
    id: string;
    title: string;
    phase: string;
    role: string;
    agent: string;
    status: 'proposed' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';
    depends: string[];
    deliverable: string;
  }>;
}

export interface ConfirmDeliveryBreakdownCommand extends WorkspaceCommandBase {
  type: 'delivery.breakdown.confirm';
  projectName: string;
  projectGoal: string;
  phases: Array<{
    id: string;
    title: string;
    description: string;
    order: number;
    status: 'planned' | 'active' | 'done';
    tasks: Array<{
      id: string;
      title: string;
      description?: string;
      agentId?: string;
      dependencies: string[];
      role: string;
      deliverable: string;
    }>;
  }>;
}

export interface SubmitDeliveryRequirementCommand extends WorkspaceCommandBase {
  type: 'delivery.requirement.submit';
  content: string;
  targetAgentIds: string[];
  taskId?: string;
  mentions?: string[];
  intent?: 'ideate' | 'execute' | 'review' | 'general';
}

export interface RequestDeliveryPlanCommand extends WorkspaceCommandBase {
  type: 'delivery.plan.request';
}

export interface RequestTaskProgressCommand extends WorkspaceCommandBase {
  type: 'task.progress.request';
  taskId: string;
  request: string;
}

export interface ApplyTaskGraphCommand extends WorkspaceCommandBase {
  type: 'task.graph.apply';
  expectedRevision: number;
  action:
    | 'createRootTask'
    | 'splitTask'
    | 'mergeTasks'
    | 'reopenTask'
    | 'blockTask'
    | 'resumeTask'
    | 'assignTask'
    | 'cancelTask';
  input: Record<string, unknown>;
}

export interface CreateTaskCommand extends WorkspaceCommandBase {
  type: 'task.create';
  task: {
    id: string;
    category?: 'issue' | 'change_request' | 'improvement';
    title: string;
    description?: string;
    agentId?: string;
    dependencies: string[];
    artifacts?: Array<{ type: string; label: string; url?: string }>;
  };
  requestExecution?: boolean;
}

export interface UpdateTaskCommand extends WorkspaceCommandBase {
  type: 'task.update';
  taskId: string;
  expectedTaskRevision: number;
  updates: {
    title?: string;
    description?: string;
    agentId?: string;
    dependencies?: string[];
    artifacts?: Array<{ type: string; label: string; url?: string }>;
  };
}

export interface TransitionTaskCommand extends WorkspaceCommandBase {
  type: 'task.transition';
  taskId: string;
  expectedTaskRevision: number;
  status: 'proposed' | 'ready' | 'in_progress' | 'blocked' | 'in_review' | 'done' | 'cancelled';
  reviewNote?: string;
  evidence?: Record<string, unknown>;
}

export interface UpsertWorkPhaseCommand extends WorkspaceCommandBase {
  type: 'work.phase.upsert';
  phase: {
    id: string;
    title: string;
    description: string;
    order: number;
    status: 'planned' | 'active' | 'done';
  };
}

export interface DeleteWorkPhaseCommand extends WorkspaceCommandBase {
  type: 'work.phase.delete';
  phaseId: string;
}

export type WorkspaceCommand =
  | CreateDeliveryCommand
  | DeleteDeliveryCommand
  | AdvanceDeliveryCommand
  | MaterializeDeliveryBreakdownCommand
  | ConfirmDeliveryBreakdownCommand
  | SubmitDeliveryRequirementCommand
  | RequestDeliveryPlanCommand
  | RequestTaskProgressCommand
  | CreateTaskCommand
  | UpdateTaskCommand
  | TransitionTaskCommand
  | UpsertWorkPhaseCommand
  | DeleteWorkPhaseCommand
  | ApplyTaskGraphCommand;

export interface WorkspaceCommandReceipt {
  idempotencyKey: string;
  commandType: WorkspaceCommand['type'];
  projectPath: string;
  deliveryId: string;
  status: 'accepted' | 'rejected';
  duplicate: boolean;
  messageId?: string;
  taskId?: string;
  targetAgentIds: string[];
  reasonCode?: string;
  userMessage?: string;
  result?: unknown;
  recordedAt: string;
}

export interface WorkspaceCommandGateway {
  submit(command: WorkspaceCommand): Promise<WorkspaceCommandReceipt>;
}

export class WorkspaceCommandRequestError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'WorkspaceCommandRequestError';
  }
}

export function createWorkspaceCommandIdempotencyKey(scope: string): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `workspace:${scope}:${Date.now().toString(36)}:${random}`;
}
