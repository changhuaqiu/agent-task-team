import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { getDb } from '../db';
import type { TaskRow } from '../repositories/task-repo';
import { generateSortableId } from '../repositories/sortable-id';
import type { AgentActivationCommand } from '../invocation-pipeline/types';
import type { ExecutionProfile } from '../invocation-pipeline/execution-profile';
import { WorkContractInvariantError, workContractRepo } from './repository';
import type { AgentOutcomeType, WorkContract } from './types';
import { parseWorkIdentity } from './work-identity';
import { AGENT_OUTCOME_TOOL_BY_TYPE } from './outcome-tools';
import type { DispatchAdmissionGrant } from '../invocation-pipeline/dispatch-admission';

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

const PLANNING_OUTCOMES: AgentOutcomeType[] = [
  'continue_work',
  'propose_task_graph',
  'handoff_to_agent',
  'report_blocked',
  'request_human_decision',
];

const DOMAIN_MUTATION_TOOLS = new Set([
  'task_create',
  'task_update_status',
  'task_assign',
  'collaboration_record_pr',
  'collaboration_record_review',
  'collaboration_record_merge',
]);

export function workContractRuntimeToolNames(
  toolNames: string[],
  allowedOutcomeTypes: AgentOutcomeType[] = EXECUTION_OUTCOMES,
): string[] {
  return [...new Set([
    ...toolNames.filter((toolName) => !DOMAIN_MUTATION_TOOLS.has(toolName)),
    ...allowedOutcomeTypes.map((outcomeType) => AGENT_OUTCOME_TOOL_BY_TYPE[outcomeType]),
  ])].sort();
}

interface WorkContractPermissions {
  executionMode?: 'standard' | 'outcome_recovery';
  executionProfile?: ExecutionProfile;
  tools?: unknown;
  authorization?: unknown;
  dispatchAdmission?: unknown;
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
  const executionSubjectId = trigger.executionSubject?.id.trim();
  if (executionSubjectId) return `ad-hoc:${executionSubjectId}:agent:${trigger.agentId}`;
  const explicit = trigger.workId?.trim();
  if (explicit) return explicit;
  if (trigger.passId) return `a2a-pass:${trigger.passId}`;
  if (
    trigger.deliveryRunId
    && (trigger.source === 'review_gate' || trigger.source === 'test_gate')
  ) {
    return `delivery:${trigger.deliveryRunId}:agent:${trigger.agentId}:purpose:${purposeFor(trigger)}`;
  }
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
  admission: DispatchAdmissionGrant;
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
    const workId = deriveWorkId(input.trigger);
    const workIdentity = parseWorkIdentity(workId);
    const currentTask = input.trigger.taskId
      ? db.prepare('SELECT id,status,agent_id,revision FROM task WHERE id=? AND conversation_id=?')
          .get(input.trigger.taskId, input.trigger.conversationId) as {
            id: string;
            status: string;
            agent_id: string;
            revision: number;
          } | undefined
      : undefined;
    if (input.trigger.taskId && !currentTask) {
      throw new WorkContractInvariantError(`Task authority is missing: ${input.trigger.taskId}`);
    }
    if (input.admission.kind === 'execution' && input.trigger.taskId) {
      const frozen = input.admission.taskAuthority;
      if (
        !currentTask
        || !input.task
        || !frozen
        || frozen.taskId !== currentTask.id
        || frozen.ownerAgentId !== input.trigger.agentId
        || frozen.ownerAgentId !== currentTask.agent_id
        || frozen.revision !== currentTask.revision
        || input.task.agent_id !== currentTask.agent_id
        || input.task.revision !== currentTask.revision
      ) {
        throw new WorkContractInvariantError(`Task authority changed before contract issuance: ${input.trigger.taskId}`);
      }
    }
    if (
      currentTask
      && ['done', 'cancelled'].includes(currentTask.status)
      && workIdentity?.scope !== 'delivery'
    ) {
      throw new WorkContractInvariantError(`Task owner is terminal: ${input.trigger.taskId}`);
    }
    if (input.trigger.source === 'review_gate' && workIdentity?.scope === 'task') {
      const gate = workIdentity.gateId
        ? db.prepare(`
            SELECT id,conversation_id,kind,target_type,target_id,artifact_revision,status,revision
            FROM quality_gate
            WHERE id=?
          `).get(workIdentity.gateId) as {
            id: string;
            conversation_id: string;
            kind: string;
            target_type: string;
            target_id: string;
            artifact_revision: string;
            status: string;
            revision: number;
          } | undefined
        : undefined;
      if (
        !currentTask
        || !gate
        || gate.conversation_id !== input.trigger.conversationId
        || gate.kind !== 'code_review'
        || gate.target_type !== 'task'
        || gate.target_id !== currentTask.id
        || workIdentity.targetId !== currentTask.id
        || workIdentity.agentId !== input.trigger.agentId
        || currentTask.status !== 'in_review'
        || gate.artifact_revision !== String(currentTask.revision)
        || !['requested', 'evaluating'].includes(gate.status)
      ) {
        throw new WorkContractInvariantError(
          `Task review Gate is missing, stale, or terminal: ${workIdentity.gateId ?? 'missing'}`,
        );
      }
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
    const currentEpoch = workContractRepo.getAuthority(workId)?.current_epoch ?? 0;
    const authoritativeRefs = [
      `context_snapshot:${input.contextSnapshot.id}`,
      ...(input.task ? [`task:${input.task.id}`] : []),
      ...(delivery ? [`delivery_run:${delivery.id}`] : []),
      ...(input.trigger.passId ? [`a2a_pass:${input.trigger.passId}`] : []),
      ...(input.trigger.possessionId ? [`a2a_possession:${input.trigger.possessionId}`] : []),
      ...(input.trigger.executionSubject
        ? [`ad_hoc_execution:${input.trigger.executionSubject.id}`]
        : []),
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
        : input.admission.kind === 'planning'
          ? ['Return a structured plan, assignment, handoff, blocker, or human decision request']
          : ['Return a structured outcome with evidence']);
    const gateWork = input.trigger.source === 'review_gate' || input.trigger.source === 'test_gate';

    const outcomeRecovery = input.trigger.executionMode === 'outcome_recovery';
    const allowedOutcomeTypes = gateWork
      ? GATE_OUTCOMES
      : input.admission.kind === 'planning'
        ? PLANNING_OUTCOMES
        : EXECUTION_OUTCOMES;
    const deliveryAuthorization = deliveryContract?.authorization !== null
      && typeof deliveryContract?.authorization === 'object'
      ? deliveryContract.authorization as Record<string, unknown>
      : {};
    const allowCodeChanges = input.admission.allowCodeChanges
      && (!delivery || deliveryAuthorization.allowCodeChanges === true);
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
        dispatchAdmission: {
          kind: input.admission.kind,
          reasonCode: input.admission.reasonCode,
          agentDefinitionId: input.admission.role.definitionId,
          agentDefinitionRevision: input.admission.role.definitionRevision,
        },
        runtime: {
          engine: input.runtime.engine,
          runtimeId: input.runtime.runtimeId,
          ...(input.runtime.accountId ? { accountId: input.runtime.accountId } : {}),
        },
        tools: outcomeRecovery
          ? allowedOutcomeTypes.map((outcomeType) => AGENT_OUTCOME_TOOL_BY_TYPE[outcomeType])
          : workContractRuntimeToolNames(input.runtime.toolNames, allowedOutcomeTypes),
        authorization: outcomeRecovery ? {} : {
          ...deliveryAuthorization,
          allowCodeChanges,
        },
      },
      authoritativeRefs,
      authoritativeRevisions,
      contextSnapshotRef: input.contextSnapshot.id,
      allowedOutcomeTypes,
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
  const lifecycleTools = contract.allowedOutcomeTypes
    .map((outcomeType) => AGENT_OUTCOME_TOOL_BY_TYPE[outcomeType]);
  return [
    '# Platform Work Contract',
    '',
    'This invocation is authorized only by the immutable contract below.',
    outcomeRecovery
      ? `This is a command-only recovery turn. Obtain exactly one accepted lifecycle result using: ${lifecycleTools.join(', ')}.`
      : `Submit candidate results using a matching lifecycle tool: ${lifecycleTools.join(', ')}.`,
    'The tool binds the private fencing token and authoritative revisions for this invocation.',
    'A stale epoch or superseded attempt will be rejected; do not mutate domain state directly.',
    'Treat TASKS.md, task status, assignee, deliverable metadata, and gate state as read-only projections.',
    ...(executionProfile ? [
      `Execution stage: ${executionProfile.stage}.`,
      `Required capabilities: ${executionProfile.capabilities.length > 0 ? executionProfile.capabilities.join(', ') : 'none'}.`,
      `Exit policy: ${executionProfile.exitPolicy}. Follow this exit; do not substitute a progress-only reply.`,
    ] : []),
    ...(permissionEnvelope(contract).dispatchAdmission
      ? [`Authorized dispatch: ${JSON.stringify(permissionEnvelope(contract).dispatchAdmission)}.`]
      : []),
    ...(executionProfile?.stage === 'plan' ? [
      'This is a planning contract. Do not edit files or implement the requested change; inspect, decompose, assign, hand off, or request a decision.',
    ] : []),
    ...(outcomeRecovery ? [
      'Do not repeat implementation, review, verification, shell commands, file edits, delegation, or exploratory work.',
      'Use the previous durable reply and evidence already present in context to choose one allowed structured exit.',
      'Do not send a narrative assistant reply before calling the lifecycle tool.',
    ] : []),
    'Before ending, obtain exactly one accepted terminal command or one accepted work_continue checkpoint; rejected validation attempts must be corrected and retried. The CommandService applies task and gate transitions atomically.',
    'If substantial work remains but this Invocation must stop, call work_continue with payload '
      + '{ schemaVersion: 1, reason: multi_step | context_boundary | verification_follow_up, summary, nextAction, completedSteps: string[], remainingSteps: non-empty string[] }. '
      + 'The platform will start a bounded continuation from that checkpoint; do not use work_continue for an external or human blocker.',
    'Tool calls are visible in the platform trace. Do not narrate or repeat the tool sequence in assistant text.',
    'If a lifecycle tool rejects candidate input, correct the structured payload and retry within this turn. '
      + 'Never expose raw platform reason codes as the final user-facing result or treat a correctable contract rejection as an external blocker.',
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
