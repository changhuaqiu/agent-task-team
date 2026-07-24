import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { PlatformEventLog } from './event-log';
import type { PlatformEventHandler } from './dispatcher';
import type { PlatformEvent } from './types';

export interface RuntimeCompletionContext {
  invocation_id: string;
  conversation_id: string;
  agent_id: string;
  task_id: string | null;
  chain_id: string | null;
  pass_id: string | null;
  context_scenario: string | null;
  team_log_up_to_entry_id: string | null;
  task_project_dir: string;
  evaluation_execution_id: string | null;
  source_event_id: string | null;
  status: 'pending' | 'completed';
}

export interface RuntimeCompletionPort {
  complete(
    context: RuntimeCompletionContext,
    output: string,
    event: PlatformEvent,
    signal: AbortSignal,
  ): void | Promise<void>;
}

export function runRuntimeCompletionStep(
  eventId: string,
  step: string,
  action: () => void,
  database?: Database.Database,
): boolean {
  const db = database ?? getDb();
  return db.transaction(() => {
    const existing = db.prepare(`
      SELECT 1 FROM runtime_completion_step_receipt WHERE event_id=? AND step=?
    `).get(eventId, step);
    if (existing) return false;
    action();
    db.prepare(`
      INSERT INTO runtime_completion_step_receipt (event_id,step,completed_at)
      VALUES (?,?,?)
    `).run(eventId, step, new Date().toISOString());
    return true;
  }).immediate();
}

export class RuntimeCompletionProcessManager {
  constructor(
    private readonly port: RuntimeCompletionPort,
    private readonly database?: Database.Database,
    private readonly eventLog?: PlatformEventLog,
  ) {}

  readonly handle: PlatformEventHandler = async (event, { signal }) => {
    if (event.type !== 'runtime.invocation.terminated' || !event.invocationId) return;
    if (signal.aborted) throw signal.reason ?? new Error('runtime_completion_aborted');
    const db = this.database ?? getDb();
    const context = db.prepare(
      `SELECT * FROM runtime_completion_context WHERE invocation_id=?`,
    ).get(event.invocationId) as RuntimeCompletionContext | undefined;
    // Historical Runtime Events predate durable completion contexts and were
    // already handled by the compatibility path.
    if (!context || context.status === 'completed') return;
    db.prepare(`
      UPDATE runtime_completion_context
      SET source_event_id=COALESCE(source_event_id,?), updated_at=?
      WHERE invocation_id=? AND (source_event_id IS NULL OR source_event_id=?)
    `).run(event.eventId, new Date().toISOString(), event.invocationId, event.eventId);
    const bound = db.prepare(
      `SELECT * FROM runtime_completion_context WHERE invocation_id=?`,
    ).get(event.invocationId) as RuntimeCompletionContext;
    if (bound.source_event_id !== event.eventId) {
      throw new Error('runtime_completion_source_event_conflict');
    }
    const output = (this.eventLog ?? new PlatformEventLog({ db }))
      .listStream(event.streamKey)
      .filter((item) => item.type === 'runtime.message.segment.completed')
      .map((item) => (item.payload as { text?: string }).text ?? '')
      .join('');
    await this.port.complete(bound, output, event, signal);
    if (signal.aborted) throw signal.reason ?? new Error('runtime_completion_aborted');
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE runtime_completion_context
      SET status='completed', completed_at=?, updated_at=?
      WHERE invocation_id=? AND source_event_id=? AND status='pending'
    `).run(now, now, event.invocationId, event.eventId);
  };
}

export const runtimeCompletionContextRepo = {
  create(input: {
    invocationId: string;
    conversationId: string;
    agentId: string;
    taskId?: string;
    chainId?: string;
    passId?: string;
    contextScenario?: string;
    teamLogUpToEntryId?: string;
    taskProjectDir: string;
    evaluationExecutionId?: string;
  }): void {
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO runtime_completion_context (
        invocation_id,conversation_id,agent_id,task_id,chain_id,pass_id,
        context_scenario,team_log_up_to_entry_id,task_project_dir,
        evaluation_execution_id,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?)
    `).run(
      input.invocationId,
      input.conversationId,
      input.agentId,
      input.taskId ?? null,
      input.chainId ?? null,
      input.passId ?? null,
      input.contextScenario ?? null,
      input.teamLogUpToEntryId ?? null,
      input.taskProjectDir,
      input.evaluationExecutionId ?? null,
      now,
      now,
    );
  },

  updateTaskProjectDir(invocationId: string, taskProjectDir: string): void {
    getDb().prepare(`
      UPDATE runtime_completion_context SET task_project_dir=?, updated_at=?
      WHERE invocation_id=? AND status='pending'
    `).run(taskProjectDir, new Date().toISOString(), invocationId);
  },
};
