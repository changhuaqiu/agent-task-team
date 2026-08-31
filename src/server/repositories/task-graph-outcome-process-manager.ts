import { CollaborationKernel } from '../collaboration-kernel';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import { qualityGateRepo } from '../quality-gate/repository';
import { buildWorkIdentity } from '../work-contract/work-identity';
import { projectAgentMembershipRepo } from './project-agent-membership-repo';
import { taskRepo } from './task-repo';
import {
  taskGraphRepo,
  type TaskGraphCommitTask,
  type TaskGraphCommitResult,
} from './task-graph-repo';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';

export class TaskGraphOutcomeInvariantError extends Error {
  constructor(readonly reasonCode: string, detail: string) {
    super(detail);
  }
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TaskGraphOutcomeInvariantError(
      `task_graph_${field.replaceAll(/[^a-zA-Z0-9]+/g, '_').toLowerCase()}_required`,
      `Task Graph outcome requires ${field}`,
    );
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

export interface ParsedTaskGraphOutcome {
  expectedRevision: number;
  tasks: TaskGraphCommitTask[];
}

export function parseTaskGraphOutcome(payload: unknown): ParsedTaskGraphOutcome {
  let value = payload;
  if (typeof payload === 'string') {
    try {
      value = JSON.parse(payload);
    } catch {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_payload_invalid',
        'Task Graph outcome payload must be JSON',
      );
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_payload_invalid',
      'Task Graph outcome payload must be an object',
    );
  }
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 0) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_expected_revision_required',
      'Task Graph outcome requires expectedRevision',
    );
  }
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_tasks_required',
      'Task Graph outcome requires tasks',
    );
  }
  const tasks = record.tasks.map((item, index): TaskGraphCommitTask => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_task_invalid',
        `Task Graph tasks[${index}] must be an object`,
      );
    }
    const task = item as Record<string, unknown>;
    const dependencies = task.dependencies === undefined ? [] : task.dependencies;
    if (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== 'string')) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_dependencies_invalid',
        `Task Graph tasks[${index}].dependencies must be strings`,
      );
    }
    const initialStatus = task.initialStatus;
    if (initialStatus !== undefined && initialStatus !== 'proposed' && initialStatus !== 'ready') {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_initial_status_invalid',
        `Task Graph tasks[${index}].initialStatus is invalid`,
      );
    }
    const intent = task.intent ?? 'implement';
    if (!['implement', 'review', 'verify', 'plan'].includes(String(intent))) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_intent_invalid',
        `Task Graph tasks[${index}].intent is invalid`,
      );
    }
    const description = optionalString(task.description, `tasks[${index}].description`);
    return {
      id: requiredString(task.id, `tasks[${index}].id`),
      title: requiredString(task.title, `tasks[${index}].title`),
      agent_id: requiredString(task.agentId, `tasks[${index}].agentId`),
      intent: intent as TaskGraphCommitTask['intent'],
      ...(description ? { description } : {}),
      dependencies: dependencies.map((dependency) => dependency.trim()).filter(Boolean),
      ...(initialStatus ? { initialStatus } : {}),
    };
  });
  return { expectedRevision: Number(record.expectedRevision), tasks };
}

function dependenciesSatisfied(taskId: string): boolean {
  const task = taskRepo.getById(taskId);
  if (!task) return false;
  let dependencies: unknown = [];
  try {
    dependencies = task.dependencies ? JSON.parse(task.dependencies) : [];
  } catch {
    return false;
  }
  return Array.isArray(dependencies) && dependencies.every((dependency) => (
    typeof dependency === 'string' && taskRepo.getById(dependency)?.status === 'done'
  ));
}

export function enqueueStandaloneTask(
  contract: WorkContractRow,
  outcome: AgentOutcomeRow,
  frozen: TaskGraphCommitResult['tasks'][number],
): void {
  if (!ownsLatestStandaloneTask({ contract, outcome }, frozen.id)) return;
  const current = taskRepo.getById(frozen.id);
  if (
    !current
    || current.conversation_id !== contract.project_id
    || current.agent_id !== frozen.agent_id
    || !dependenciesSatisfied(current.id)
  ) return;
  if (current.intent === 'review' || current.intent === 'verify') {
    enqueueGateTask(contract, outcome, current);
    return;
  }
  if (current.status !== 'ready') return;
  new CollaborationKernel({ db: getDb() }).request({
    projectId: contract.project_id,
    targetAgentId: frozen.agent_id,
    source: 'workflow',
    requestedAction: frozen.description?.trim() || frozen.title,
    idempotencyKey: `task-graph-outcome:${outcome.id}:task:${frozen.id}`,
    cause: {
      correlationId: outcome.correlation_id,
      causationId: outcome.id,
    },
    scope: {
      taskId: frozen.id,
    },
    ...(current.intent === 'plan' ? { context: { scenario: 'planning' as const } } : {}),
    replyTo: { type: 'task', id: frozen.id },
  });
}

function enqueueGateTask(
  contract: WorkContractRow,
  outcome: AgentOutcomeRow,
  input: ReturnType<typeof taskRepo.getById> & {},
): void {
  if (!input || !['proposed', 'ready', 'in_progress', 'in_review'].includes(input.status)) return;
  const task = taskGraphRepo.prepareGateTask(input.id, contract.project_id);
  if (!task || task.status !== 'in_review') return;

  const gate = qualityGateRepo.request({
    conversationId: contract.project_id,
    kind: 'code_review',
    targetType: 'task',
    targetId: task.id,
    artifactRevision: String(task.revision),
    criteria: {
      taskIntent: task.intent,
      taskTitle: task.title,
      requestedAction: task.description?.trim() || task.title,
    },
    policy: {
      source: 'task_graph_intent',
      authorizedEvaluatorIds: [task.agent_id],
    },
    actor: { type: 'system', id: 'task-graph-outcome-process-manager' },
    correlationId: outcome.correlation_id,
    causationId: outcome.id,
    now: new Date(outcome.occurred_at),
  }).gate;
  const purpose = task.intent === 'review' ? 'review' : 'verify';
  new CollaborationKernel({ db: getDb() }).request({
    projectId: contract.project_id,
    targetAgentId: task.agent_id,
    source: purpose === 'review' ? 'review_gate' : 'test_gate',
    requestedAction: [
      `${purpose === 'review' ? '评审' : '核验'}任务 ${task.id}：${task.title}。`,
      task.description?.trim() || task.title,
      `这是 QualityGate ${gate.id}。完成后必须用 gate_record_decision 记录结构化结论与证据。`,
    ].join('\n'),
    idempotencyKey: `task-graph-outcome:${outcome.id}:gate:${gate.id}`,
    cause: {
      correlationId: outcome.correlation_id,
      causationId: outcome.id,
    },
    scope: {
      taskId: task.id,
      workId: buildWorkIdentity({
        scope: 'task',
        targetId: task.id,
        agentId: task.agent_id,
        gateId: gate.id,
        purpose,
      }),
    },
    context: { scenario: purpose === 'review' ? 'code_review' : 'verification' },
    replyTo: { type: 'quality_gate', id: gate.id },
  });
}

export function ownsLatestStandaloneTask(
  input: { contract: WorkContractRow; outcome: AgentOutcomeRow },
  taskId: string,
): boolean {
  if (input.contract.delivery_run_id) return false;
  const latest = getDb().prepare(`
    SELECT commit_record.idempotency_key
    FROM task_graph_commit commit_record
    JOIN task_action action ON action.id=commit_record.action_id
    WHERE commit_record.conversation_id=?
      AND EXISTS (
        SELECT 1 FROM json_each(action.task_ids) item WHERE item.value=?
      )
    ORDER BY commit_record.revision DESC,commit_record.created_at DESC
    LIMIT 1
  `).get(input.contract.project_id, taskId) as { idempotency_key: string } | undefined;
  if (!latest) return false;
  if (latest.idempotency_key === `task-graph-outcome:${input.outcome.id}`) return true;
  const legacyEvent = getDb().prepare(`
    SELECT 1
    FROM platform_event
    WHERE id=? AND type='agent.outcome.accepted'
      AND aggregate_type='agent_outcome' AND aggregate_id=?
  `).get(latest.idempotency_key, input.outcome.id);
  return Boolean(legacyEvent);
}

function enqueueStandaloneTasks(
  contract: WorkContractRow,
  outcome: AgentOutcomeRow,
  committed: TaskGraphCommitResult,
): void {
  if (contract.delivery_run_id) return;
  for (const frozen of committed.tasks) {
    enqueueStandaloneTask(contract, outcome, frozen);
  }
}

function legacyCommittedResult(
  eventId: string,
  conversationId: string,
): TaskGraphCommitResult | undefined {
  const record = taskGraphRepo.getCommitByIdempotencyKey(eventId);
  if (!record) return undefined;
  if (record.conversation_id !== conversationId) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_project_mismatch',
      'Historical Task Graph commit belongs to a different Project',
    );
  }
  const frozen = JSON.parse(record.result_json) as Partial<TaskGraphCommitResult>;
  if (
    frozen.revision !== record.revision
    || !Array.isArray(frozen.tasks)
    || !Array.isArray(frozen.edges)
    || frozen.action?.id !== record.action_id
  ) {
    const action = taskGraphRepo.getActionById(record.action_id);
    if (!action || action.conversation_id !== conversationId) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_legacy_replay_unavailable',
        `Historical Task Graph commit ${eventId} has no recoverable action`,
      );
    }
    let taskIds: unknown;
    try {
      taskIds = JSON.parse(action.task_ids);
    } catch {
      taskIds = undefined;
    }
    if (!Array.isArray(taskIds) || taskIds.some((taskId) => typeof taskId !== 'string')) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_legacy_replay_unavailable',
        `Historical Task Graph commit ${eventId} has invalid task identity`,
      );
    }
    const tasks = taskIds.map((taskId) => taskRepo.getById(taskId));
    if (tasks.some((task) => !task || task.conversation_id !== conversationId)) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_legacy_replay_unavailable',
        `Historical Task Graph commit ${eventId} references unavailable Tasks`,
      );
    }
    const taskIdSet = new Set(taskIds);
    return {
      revision: record.revision,
      tasks: tasks as TaskGraphCommitResult['tasks'],
      edges: taskGraphRepo.listEdges(conversationId).filter((edge) => taskIdSet.has(edge.from_task_id)),
      action,
    };
  }
  return frozen as TaskGraphCommitResult;
}

/**
 * Owns the complete deterministic effect of an accepted Task Graph proposal.
 * Admission uses it synchronously; the event handler only recovers historical
 * accepted outcomes through the same idempotent interface.
 */
export function applyAcceptedTaskGraphOutcome(input: {
  contract: WorkContractRow;
  outcome: AgentOutcomeRow;
  allowLegacyUnfrozenAuthority?: boolean;
}): TaskGraphCommitResult {
  const db = getDb();
  return db.transaction(() => {
    if (input.contract.project_id !== input.outcome.project_id) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_project_mismatch',
        'Task Graph outcome project does not match WorkContract',
      );
    }
    const proposal = parseTaskGraphOutcome(input.outcome.payload_json);
    const authoritativeRevisions = JSON.parse(
      input.contract.authoritative_revisions_json,
    ) as Record<string, unknown>;
    const frozenRevision = authoritativeRevisions.taskGraph;
    if (!Number.isSafeInteger(frozenRevision) || Number(frozenRevision) < 0) {
      if (input.allowLegacyUnfrozenAuthority) {
        return commitTaskGraphProposal(input.contract, input.outcome, proposal);
      }
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_authority_missing',
        'WorkContract does not carry frozen Task Graph authority',
      );
    }
    if (proposal.expectedRevision !== frozenRevision) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_authority_mismatch',
        `Task Graph proposal revision ${proposal.expectedRevision} does not match frozen authority ${frozenRevision}`,
      );
    }
    assertCoordinationObligation(input.contract, proposal);
    return commitTaskGraphProposal(input.contract, input.outcome, proposal);
  }).immediate();
}

function assertCoordinationObligation(
  contract: WorkContractRow,
  proposal: ParsedTaskGraphOutcome,
): void {
  let permissions: unknown;
  try {
    permissions = JSON.parse(contract.permissions_json);
  } catch {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_coordination_contract_invalid',
      'WorkContract permissions are invalid',
    );
  }
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) return;
  const coordination = (permissions as Record<string, unknown>).coordination;
  if (!coordination || typeof coordination !== 'object' || Array.isArray(coordination)) return;
  const record = coordination as Record<string, unknown>;
  if (record.mode !== 'task_graph_first') return;
  if (
    !Array.isArray(record.requiredTaskIds)
    || record.requiredTaskIds.length === 0
    || record.requiredTaskIds.some((taskId) => typeof taskId !== 'string' || !taskId.trim())
  ) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_coordination_contract_invalid',
      'Task Graph-first coordination requires frozen Task IDs',
    );
  }
  const proposalTaskIds = new Set(proposal.tasks.map((task) => task.id));
  const missingTaskIds = (record.requiredTaskIds as string[])
    .map((taskId) => taskId.trim())
    .filter((taskId) => !proposalTaskIds.has(taskId));
  if (missingTaskIds.length > 0) {
    throw new TaskGraphOutcomeInvariantError(
      'task_graph_coordination_tasks_missing',
      `Task Graph proposal omits frozen coordination Tasks: ${missingTaskIds.join(', ')}`,
    );
  }
}

function commitTaskGraphProposal(
  contract: WorkContractRow,
  outcome: AgentOutcomeRow,
  proposal: ParsedTaskGraphOutcome,
): TaskGraphCommitResult {
  const projectAgents = new Set(
    projectAgentMembershipRepo.listAgentIdsByConversation(contract.project_id),
  );
  for (const task of proposal.tasks) {
    if (!projectAgents.has(task.agent_id)) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_agent_not_in_project',
        `Task ${task.id} assignee ${task.agent_id} is not a Project member`,
      );
    }
  }
  const committed = taskGraphRepo.commit({
    conversationId: contract.project_id,
    expectedRevision: proposal.expectedRevision,
    idempotencyKey: `task-graph-outcome:${outcome.id}`,
    actorId: contract.agent_id,
    actorType: 'agent',
    correlationId: outcome.correlation_id,
    causationId: outcome.id,
    tasks: proposal.tasks,
    now: new Date(outcome.occurred_at),
  });
  enqueueStandaloneTasks(contract, outcome, committed);
  return committed;
}

export class TaskGraphOutcomeProcessManager {
  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('task_graph_outcome_aborted');
    const db = getDb();
    const outcome = db.prepare(`
      SELECT * FROM agent_outcome
      WHERE id=? AND admission_status='accepted' AND outcome_type='propose_task_graph'
    `).get(event.aggregate.id) as AgentOutcomeRow | undefined;
    if (!outcome) return;
    const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
      .get(outcome.contract_id) as WorkContractRow | undefined;
    if (!contract) {
      throw new TaskGraphOutcomeInvariantError(
        'task_graph_contract_missing',
        `WorkContract ${outcome.contract_id} not found`,
      );
    }
    const legacy = legacyCommittedResult(event.eventId, contract.project_id);
    if (legacy) {
      enqueueStandaloneTasks(contract, outcome, legacy);
      return;
    }
    applyAcceptedTaskGraphOutcome({ contract, outcome, allowLegacyUnfrozenAuthority: true });
  };
}
