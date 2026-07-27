import type { ContextSnapshot } from '../../lib/agent-context/ContextManager';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import type { TaskRow } from '../repositories/task-repo';
import { generateSortableId } from '../repositories/sortable-id';
import type { HarnessTrigger } from '../harness/types';
import { workContractRepo } from './repository';
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
  'record_gate_decision',
  'report_blocked',
  'request_human_decision',
];

function purposeFor(trigger: HarnessTrigger): string {
  if (trigger.source === 'review_gate') return 'review';
  if (trigger.source === 'test_gate') return 'verify';
  if (trigger.source === 'a2a') return 'delegate';
  return 'execute';
}

export function deriveWorkId(trigger: HarnessTrigger): string {
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
  trigger: HarnessTrigger;
  traceId: string;
  contextSnapshot: ContextSnapshot;
  task?: TaskRow;
  role: unknown;
  runtime: {
    engine: string;
    runtimeId: string;
    accountId?: string;
    toolNames: string[];
  };
}): WorkContract {
  const delivery = input.trigger.deliveryRunId
    ? autonomousDeliveryRepo.getRun(input.trigger.deliveryRunId)
    : undefined;
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
  ];
  const authoritativeRevisions: Record<string, string | number> = {
    contextSnapshot: input.contextSnapshot.id,
    ...(input.task ? { task: input.task.updated_at } : {}),
    ...(delivery ? { deliveryRun: delivery.revision } : {}),
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
      runtime: {
        engine: input.runtime.engine,
        runtimeId: input.runtime.runtimeId,
        ...(input.runtime.accountId ? { accountId: input.runtime.accountId } : {}),
      },
      tools: [...new Set([
        ...input.runtime.toolNames,
        'agent_submit_outcome',
      ])].sort(),
      authorization: deliveryContract?.authorization ?? {},
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
    causationId: input.trigger.id,
    expectedCurrentEpoch: currentEpoch,
  });
}

export function renderWorkContractInstruction(contract: WorkContract): string {
  return [
    '# Platform Work Contract',
    '',
    'This invocation is authorized only by the immutable contract below.',
    'Report candidate results with the agent_submit_outcome platform tool.',
    'The tool binds the private fencing token and authoritative revisions for this invocation.',
    'A stale epoch or superseded attempt will be rejected; do not mutate domain state directly.',
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
