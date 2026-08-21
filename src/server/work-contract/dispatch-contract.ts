import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { getDb } from '../db';
import type { TaskRow } from '../repositories/task-repo';
import { generateSortableId } from '../repositories/sortable-id';
import type { AgentActivationCommand } from '../invocation-pipeline/types';
import type { ExecutionProfile } from '../invocation-pipeline/execution-profile';
import { WorkContractInvariantError, workContractRepo } from './repository';
import type { AgentOutcomeType, WorkContract } from './types';

const EXECUTION_OUTCOMES: AgentOutcomeType[] = [
  'continue_work',
  'propose_task_graph',
  'submit_task_result',
  'request_review',
  'handoff_to_agent',
  'report_blocked',
  'request_human_decision',
];

const GATE_OUTCOMES: AgentOutcomeType[] = [
  'continue_work',
  'record_gate_decision',
  'report_blocked',
  'request_human_decision',
];

interface WorkContractPermissions {
  executionMode?: 'standard' | 'outcome_recovery';
  executionProfile?: ExecutionProfile;
  tools?: unknown;
  authorization?: unknown;
}

function permissionEnvelope(contract: WorkContract): WorkContractPermissions {
  return contract.permissions !== null && typeof contract.permissions === 'object'
    ? contract.permissions as WorkContractPermissions
    : {};
}

export function workContractToolNames(contract: WorkContract): string[] {
  const tools = permissionEnvelope(contract).tools;
  return Array.isArray(tools)
    ? [...new Set(tools.filter((tool): tool is string => typeof tool === 'string' && Boolean(tool.trim())))]
    : [];
}

export function isOutcomeRecoveryContract(contract: WorkContract): boolean {
  return permissionEnvelope(contract).executionMode === 'outcome_recovery';
}

export class StaleA2APossessionError extends Error {
  readonly reasonCode = 'a2a_possession_stale';

  constructor(readonly detail: string) {
    super(`A2A possession is not dispatchable: ${detail}`);
  }
}

function assertA2APossessionDispatchable(trigger: AgentActivationCommand): void {
  if (!trigger.possessionId) return;
  if (!Number.isSafeInteger(trigger.possessionRevision) || Number(trigger.possessionRevision) < 0) {
    throw new StaleA2APossessionError('revision_required');
  }
  const possession = getDb().prepare(`
    SELECT
      possession.chain_id,
      possession.holder_id,
      possession.status,
      possession.revision,
      chain.conversation_id,
      chain.status chain_status
    FROM a2a_possession possession
    JOIN a2a_possession_chain chain ON chain.id=possession.chain_id
    WHERE possession.id=?
  `).get(trigger.possessionId) as {
    chain_id: string;
    holder_id: string;
    status: string;
    revision: number;
    conversation_id: string;
    chain_status: string;
  } | undefined;
  if (!possession) throw new StaleA2APossessionError('not_found');
  if (possession.conversation_id !== trigger.conversationId) {
    throw new StaleA2APossessionError('project_mismatch');
  }
  if (possession.holder_id !== trigger.agentId) {
    throw new StaleA2APossessionError('holder_mismatch');
  }
  if (trigger.chainId && possession.chain_id !== trigger.chainId) {
    throw new StaleA2APossessionError('chain_mismatch');
  }
  if (possession.chain_status !== 'active' || possession.status !== 'open') {
    throw new StaleA2APossessionError('not_open');
  }
  if (possession.revision !== trigger.possessionRevision) {
    throw new StaleA2APossessionError('revision_mismatch');
  }
}

function purposeFor(trigger: AgentActivationCommand): string {
  if (trigger.source === 'review_gate') return 'review';
  if (trigger.source === 'test_gate') return 'verify';
  if (trigger.source === 'a2a') return 'delegate';
  return 'execute';
}

function deriveWorkId(trigger: AgentActivationCommand): string {
  const explicit = trigger.workId?.trim();
  if (explicit) return explicit;
  if (trigger.passId) return `a2a-pass:${trigger.passId}`;
  if (trigger.taskId) {
    return `task:${trigger.taskId}:agent:${trigger.agentId}:purpose:${purposeFor(trigger)}`;
  }
  if (trigger.deliveryRunId) {
    return `delivery:${trigger.deliveryRunId}:agent:${trigger.agentId}:purpose:${purposeFor(trigger)}`;
  }
  return `trigger:${trigger.id}`;
}

export function issueDispatchWorkContract(input: {
  trigger: AgentActivationCommand;
  traceId: string;
  contextSnapshot: ContextSnapshot;
  task?: TaskRow;
  role: unknown;
  executionProfile: ExecutionProfile;
  runtime: {
    engine: string;
    runtimeId: string;
    accountId?: string;
    toolNames: string[];
  };
}): WorkContract {
  const db = getDb();
  return db.transaction(() => {
    assertA2APossessionDispatchable(input.trigger);
    const currentTask = input.trigger.taskId
      ? db.prepare('SELECT status FROM task WHERE id=? AND conversation_id=?')
          .get(input.trigger.taskId, input.trigger.conversationId) as { status: string } | undefined
      : undefined;
    if (currentTask && ['done', 'cancelled'].includes(currentTask.status)) {
      throw new WorkContractInvariantError(`Task owner is terminal: ${input.trigger.taskId}`);
    }
    const delivery = input.trigger.deliveryRunId
      ? autonomousDeliveryRepo.getRun(input.trigger.deliveryRunId)
      : undefined;
    if (delivery && ['completed', 'failed', 'cancelled'].includes(delivery.status)) {
      throw new WorkContractInvariantError(`Delivery owner is terminal: ${delivery.id}`);
    }
    const deliveryContract = delivery
      ? JSON.parse(delivery.goal_contract_json) as {
        goal?: string;
        acceptanceCriteria?: string[];
        authorization?: unknown;
        recoveryPolicy?: unknown;
      }
      : undefined;
    const workId = deriveWorkId(input.trigger);
    const currentEpoch = workContractRepo.getAuthority(workId)?.current_epoch ?? 0;
    const authoritativeRefs = [
      `context_snapshot:${input.contextSnapshot.id}`,
      ...(input.task ? [`task:${input.task.id}`] : []),
      ...(delivery ? [`delivery_run:${delivery.id}`] : []),
      ...(input.trigger.passId ? [`a2a_pass:${input.trigger.passId}`] : []),
      ...(input.trigger.possessionId ? [`a2a_possession:${input.trigger.possessionId}`] : []),
    ];
    const authoritativeRevisions: Record<string, string | number> = {
      contextSnapshot: input.contextSnapshot.id,
      ...(input.task ? { task: input.task.revision } : {}),
      ...(delivery ? { deliveryRun: delivery.revision } : {}),
      ...(input.trigger.possessionId
        ? { a2aPossession: Number(input.trigger.possessionRevision) }
        : {}),
    };
    const taskGoal = input.task
      ? input.task.description?.trim() || input.task.title
      : undefined;
    const goal = taskGoal || deliveryContract?.goal?.trim() || input.trigger.prompt;
    const acceptanceCriteria = deliveryContract?.acceptanceCriteria?.filter(Boolean)
      ?? (input.task
        ? [`Complete task: ${input.task.title}`, 'Submit evidence for the claimed result']
        : ['Return a structured outcome with evidence']);
    const gateWork = input.trigger.source === 'review_gate' || input.trigger.source === 'test_gate';

    const outcomeRecovery = input.trigger.executionMode === 'outcome_recovery';
    return workContractRepo.issue({
      workId,
      attemptId: generateSortableId('inv'),
      projectId: input.trigger.conversationId,
      taskId: input.trigger.taskId,
      deliveryRunId: input.trigger.deliveryRunId,
      agentId: input.trigger.agentId,
      goal,
      acceptanceCriteria,
      role: input.role ?? {},
      permissions: {
        executionMode: outcomeRecovery ? 'outcome_recovery' : 'standard',
        executionProfile: input.executionProfile,
        runtime: {
          engine: input.runtime.engine,
          runtimeId: input.runtime.runtimeId,
          ...(input.runtime.accountId ? { accountId: input.runtime.accountId } : {}),
        },
        tools: outcomeRecovery
          ? ['agent_submit_outcome']
          : [...new Set([
              ...input.runtime.toolNames,
              'agent_submit_outcome',
            ])].sort(),
        authorization: outcomeRecovery ? {} : deliveryContract?.authorization ?? {},
      },
      authoritativeRefs,
      authoritativeRevisions,
      contextSnapshotRef: input.contextSnapshot.id,
      allowedOutcomeTypes: gateWork ? GATE_OUTCOMES : EXECUTION_OUTCOMES,
      budget: {
        contextTokens: input.contextSnapshot.query.budgetTokens,
        recoveryPolicy: deliveryContract?.recoveryPolicy ?? {},
      },
      correlationId: input.traceId,
      causationId: input.trigger.causationId?.trim() || input.trigger.id,
      expectedCurrentEpoch: currentEpoch,
    });
  }).immediate();
}

export function renderWorkContractInstruction(contract: WorkContract): string {
  const outcomeRecovery = isOutcomeRecoveryContract(contract);
  const executionProfile = permissionEnvelope(contract).executionProfile;
  return [
    '# Platform Work Contract',
    '',
    'This invocation is authorized only by the immutable contract below.',
    outcomeRecovery
      ? 'This is an outcome-only recovery turn. Immediately report exactly one candidate result with the agent_submit_outcome platform tool.'
      : 'Report candidate results with the agent_submit_outcome platform tool.',
    'The tool binds the private fencing token and authoritative revisions for this invocation.',
    'A stale epoch or superseded attempt will be rejected; do not mutate domain state directly.',
    'Treat TASKS.md, task status, assignee, deliverable metadata, and gate state as read-only projections.',
    ...(executionProfile ? [
      `Execution stage: ${executionProfile.stage}.`,
      `Required capabilities: ${executionProfile.capabilities.length > 0 ? executionProfile.capabilities.join(', ') : 'none'}.`,
      `Exit policy: ${executionProfile.exitPolicy}. Follow this exit; do not substitute a progress-only reply.`,
    ] : []),
    ...(outcomeRecovery ? [
      'Do not repeat implementation, review, verification, shell commands, file edits, delegation, or exploratory work.',
      'Use the previous durable reply and evidence already present in context to choose one allowed structured exit.',
      'Do not send a narrative assistant reply before calling agent_submit_outcome.',
    ] : []),
    'Before ending, submit exactly one terminal outcome or one continue_work checkpoint; the Process Manager applies task and gate transitions atomically.',
    'If substantial work remains but this Invocation must stop, submit continue_work with payload '
      + '{ schemaVersion: 1, reason: multi_step | context_boundary | verification_follow_up, summary, nextAction, completedSteps: string[], remainingSteps: non-empty string[] }. '
      + 'The platform will start a bounded continuation from that checkpoint; do not use continue_work for an external or human blocker.',
    'Tool calls are visible in the platform trace. Do not narrate or repeat the tool sequence in assistant text.',
    '',
    '```json',
    JSON.stringify({
      contractId: contract.contractId,
      workId: contract.workId,
      workEpoch: contract.workEpoch,
      attemptId: contract.attemptId,
      projectId: contract.projectId,
      taskId: contract.taskId,
      deliveryRunId: contract.deliveryRunId,
      goal: contract.goal,
      acceptanceCriteria: contract.acceptanceCriteria,
      authoritativeRevisions: contract.authoritativeRevisions,
      contextSnapshotRef: contract.contextSnapshotRef,
      allowedOutcomeTypes: contract.allowedOutcomeTypes,
      correlationId: contract.correlationId,
    }, null, 2),
    '```',
  ].join('\n');
}
