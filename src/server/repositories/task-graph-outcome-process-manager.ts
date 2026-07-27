import type Database from 'better-sqlite3';
import { getDb } from '../db';
import type { PlatformEventHandler } from '../platform-events/dispatcher';
import type { AgentOutcomeRow, WorkContractRow } from '../work-contract/types';
import {
  InvalidTaskGraphError,
  taskGraphRepo,
  type TaskGraphCommitTask,
} from './task-graph-repo';

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidTaskGraphError(`Task Graph outcome requires ${field}`);
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function parseOutcome(payloadJson: string): {
  expectedRevision: number;
  tasks: TaskGraphCommitTask[];
} {
  let value: unknown;
  try {
    value = JSON.parse(payloadJson);
  } catch {
    throw new InvalidTaskGraphError('Task Graph outcome payload must be JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InvalidTaskGraphError('Task Graph outcome payload must be an object');
  }
  const record = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(record.expectedRevision)
    || Number(record.expectedRevision) < 0
  ) {
    throw new InvalidTaskGraphError('Task Graph outcome requires expectedRevision');
  }
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    throw new InvalidTaskGraphError('Task Graph outcome requires tasks');
  }
  const tasks = record.tasks.map((item, index): TaskGraphCommitTask => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new InvalidTaskGraphError(`Task Graph tasks[${index}] must be an object`);
    }
    const task = item as Record<string, unknown>;
    const dependencies = task.dependencies === undefined ? [] : task.dependencies;
    if (
      !Array.isArray(dependencies)
      || dependencies.some((dependency) => typeof dependency !== 'string')
    ) {
      throw new InvalidTaskGraphError(
        `Task Graph tasks[${index}].dependencies must be strings`,
      );
    }
    const initialStatus = task.initialStatus;
    if (
      initialStatus !== undefined
      && initialStatus !== 'proposed'
      && initialStatus !== 'ready'
    ) {
      throw new InvalidTaskGraphError(
        `Task Graph tasks[${index}].initialStatus is invalid`,
      );
    }
    const description = optionalString(task.description, `tasks[${index}].description`);
    return {
      id: requiredString(task.id, `tasks[${index}].id`),
      title: requiredString(task.title, `tasks[${index}].title`),
      agent_id: requiredString(task.agentId, `tasks[${index}].agentId`),
      ...(description ? { description } : {}),
      dependencies: dependencies.map((dependency) => dependency.trim()).filter(Boolean),
      ...(initialStatus ? { initialStatus } : {}),
    };
  });
  return { expectedRevision: Number(record.expectedRevision), tasks };
}

export class TaskGraphOutcomeProcessManager {
  constructor(private readonly database?: Database.Database) {}

  readonly handle: PlatformEventHandler = (event, { signal }) => {
    if (event.type !== 'agent.outcome.accepted') return;
    if (signal.aborted) throw signal.reason ?? new Error('task_graph_outcome_aborted');
    const db = this.database ?? getDb();
    const outcome = db.prepare(`
      SELECT * FROM agent_outcome
      WHERE id=? AND admission_status='accepted' AND outcome_type='propose_task_graph'
    `).get(event.aggregate.id) as AgentOutcomeRow | undefined;
    if (!outcome) return;
    const contract = db.prepare('SELECT * FROM work_contract WHERE id=?')
      .get(outcome.contract_id) as WorkContractRow | undefined;
    if (!contract) {
      throw new InvalidTaskGraphError(`WorkContract ${outcome.contract_id} not found`);
    }
    if (contract.project_id !== outcome.project_id) {
      throw new InvalidTaskGraphError('Task Graph outcome project does not match WorkContract');
    }
    const proposal = parseOutcome(outcome.payload_json);
    taskGraphRepo.commit({
      conversationId: contract.project_id,
      expectedRevision: proposal.expectedRevision,
      idempotencyKey: event.eventId,
      actorId: contract.agent_id,
      actorType: 'agent',
      correlationId: event.correlationId,
      causationId: event.eventId,
      tasks: proposal.tasks,
      now: new Date(outcome.occurred_at),
    });
  };
}
