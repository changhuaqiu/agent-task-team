import { getDb } from '../db/index';
import { DomainEventPublisher, type DomainEventType } from '../platform-events/domain-events';

export const INVOCATION_STATUSES = [
  'planned',
  'starting',
  'running',
  'terminating',
  'terminated',
] as const;

export type InvocationStatus = (typeof INVOCATION_STATUSES)[number];
const INVOCATION_STATUS_SET = new Set<string>(INVOCATION_STATUSES);

export const INVOCATION_OUTCOMES = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
] as const;

export type InvocationOutcome = (typeof INVOCATION_OUTCOMES)[number];
const INVOCATION_OUTCOME_SET = new Set<string>(INVOCATION_OUTCOMES);

const INVOCATION_TRANSITIONS: Readonly<Record<InvocationStatus, ReadonlySet<InvocationStatus>>> = {
  planned: new Set(['starting', 'terminating', 'terminated']),
  starting: new Set(['running', 'terminating', 'terminated']),
  running: new Set(['terminating', 'terminated']),
  terminating: new Set(['terminated']),
  terminated: new Set(),
};

export interface InvocationRow {
  id: string;
  conversation_id: string;
  task_id: string | null;
  agent_id: string;
  session_id: string | null;
  status: InvocationStatus;
  outcome: InvocationOutcome | null;
  engine: string | null;
  account_id: string | null;
  cli_session_id: string | null;
  prompt: string | null;
  exit_code: number | null;
  reason_code: string | null;
  usage: string | null;
  error_message: string | null;
  dispatch_status: string | null;
  token_usage: string | null;
  lease_expiry: string | null;
  started_at: string | null;
  terminated_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface NewInvocation {
  id: string;
  conversation_id: string;
  task_id?: string;
  agent_id: string;
  session_id?: string;
  engine?: string;
  account_id?: string;
  prompt?: string;
}

export type InvocationPatch = Partial<
  Pick<
    InvocationRow,
    | 'exit_code'
    | 'reason_code'
    | 'usage'
    | 'error_message'
    | 'cli_session_id'
    | 'session_id'
  >
>;

export interface InvocationTransition extends InvocationPatch {
  to: InvocationStatus;
  expectedFrom?: InvocationStatus;
  outcome?: InvocationOutcome;
}

export class InvalidInvocationTransitionError extends Error {
  readonly reasonCode = 'invalid_invocation_transition';

  constructor(
    readonly invocationId: string,
    readonly from: InvocationStatus,
    readonly to: InvocationStatus,
  ) {
    super(`Illegal invocation transition for ${invocationId}: ${from} -> ${to}`);
  }
}

export class InvalidInvocationStatusError extends Error {
  readonly reasonCode = 'invalid_invocation_status';

  constructor(readonly status: string) {
    super(`Unsupported invocation status: ${status}`);
  }
}

export class StaleInvocationTransitionError extends Error {
  readonly reasonCode = 'stale_invocation_transition';

  constructor(
    readonly invocationId: string,
    readonly expected: InvocationStatus,
    readonly actual: InvocationStatus,
  ) {
    super(`Stale invocation transition for ${invocationId}: expected ${expected}, found ${actual}`);
  }
}

export class InvalidInvocationOutcomeError extends Error {
  readonly reasonCode = 'invalid_invocation_outcome';

  constructor(readonly status: InvocationStatus, readonly outcome?: string) {
    super(
      status === 'terminated'
        ? outcome
          ? `Unsupported invocation outcome: ${outcome}`
          : 'A terminated invocation requires an outcome'
        : `Invocation outcome ${outcome ?? 'undefined'} is only valid when terminated`,
    );
  }
}

export function assertInvocationStatus(value: string): InvocationStatus {
  if (!INVOCATION_STATUS_SET.has(value)) throw new InvalidInvocationStatusError(value);
  return value as InvocationStatus;
}

export function assertInvocationOutcome(value: string): InvocationOutcome {
  if (!INVOCATION_OUTCOME_SET.has(value)) {
    throw new InvalidInvocationOutcomeError('terminated', value);
  }
  return value as InvocationOutcome;
}

export function canTransitionInvocation(from: InvocationStatus, to: InvocationStatus): boolean {
  return from === to || INVOCATION_TRANSITIONS[from].has(to);
}

function invocationStatusEvent(status: InvocationStatus): DomainEventType {
  if (status === 'planned') return 'invocation.planned';
  if (status === 'starting') return 'invocation.starting';
  if (status === 'running') return 'invocation.running';
  if (status === 'terminating') return 'invocation.terminating';
  return 'invocation.terminated';
}

export const invocationRepo = {
  create(input: NewInvocation): InvocationRow {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO invocation (
          id, conversation_id, task_id, agent_id, session_id, status,
          engine, account_id, prompt, revision, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'planned', ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        input.id,
        input.conversation_id,
        input.task_id ?? null,
        input.agent_id,
        input.session_id ?? null,
        input.engine ?? null,
        input.account_id ?? null,
        input.prompt ?? null,
        now,
        now,
      );
      new DomainEventPublisher(db).publish({
        type: 'invocation.planned',
        projectId: input.conversation_id,
        aggregate: { type: 'invocation', id: input.id, version: 0 },
        streamKey: `domain-invocation:${input.id}`,
        projectAgentId: input.agent_id,
        dedupeKey: `invocation:${input.id}:planned`,
        occurredAt: now,
        payload: { status: 'planned', taskId: input.task_id },
      });
      return invocationRepo.getById(input.id)!;
    }).immediate();
  },

  getById(id: string): InvocationRow | undefined {
    return getDb().prepare('SELECT * FROM invocation WHERE id = ?').get(id) as
      | InvocationRow
      | undefined;
  },

  transition(id: string, transition: InvocationTransition): InvocationRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = invocationRepo.getById(id);
      if (!previous) return undefined;
      assertInvocationStatus(transition.to);
      if (transition.expectedFrom && transition.expectedFrom !== previous.status) {
        throw new StaleInvocationTransitionError(id, transition.expectedFrom, previous.status);
      }
      if (!canTransitionInvocation(previous.status, transition.to)) {
        throw new InvalidInvocationTransitionError(id, previous.status, transition.to);
      }
      if (transition.to === 'terminated' && !transition.outcome) {
        throw new InvalidInvocationOutcomeError(transition.to);
      }
      if (transition.to !== 'terminated' && transition.outcome) {
        throw new InvalidInvocationOutcomeError(transition.to, transition.outcome);
      }
      if (
        previous.status === 'terminated'
        && transition.outcome !== previous.outcome
      ) {
        throw new InvalidInvocationOutcomeError(transition.to, transition.outcome);
      }
      if (previous.status === transition.to) return previous;

      const patch: InvocationPatch = transition;
      const sets = [
        'status = ?',
        'outcome = ?',
        'updated_at = ?',
        'revision = revision + 1',
      ];
      const values: unknown[] = [
        transition.to,
        transition.outcome ?? null,
        now,
      ];
      if (transition.to === 'running') {
        sets.push('started_at = COALESCE(started_at, ?)');
        values.push(now);
      }
      if (transition.to === 'terminated') {
        sets.push('terminated_at = ?');
        values.push(now);
      }
      for (const key of [
        'exit_code',
        'reason_code',
        'usage',
        'error_message',
        'cli_session_id',
        'session_id',
      ] as const) {
        const value = patch[key];
        if (value === undefined) continue;
        sets.push(`${key} = ?`);
        values.push(value);
      }
      values.push(id, previous.status);
      const result = db.prepare(
        `UPDATE invocation SET ${sets.join(', ')} WHERE id = ? AND status = ?`,
      ).run(...values);
      if (result.changes !== 1) {
        const current = invocationRepo.getById(id);
        if (current) {
          throw new StaleInvocationTransitionError(id, previous.status, current.status);
        }
        return undefined;
      }
      const current = invocationRepo.getById(id)!;
      const type = invocationStatusEvent(current.status);
      new DomainEventPublisher(db).publish({
        type,
        projectId: current.conversation_id,
        aggregate: { type: 'invocation', id, version: current.revision },
        streamKey: `domain-invocation:${id}`,
        projectAgentId: current.agent_id,
        occurredAt: now,
        payload: current.status === 'terminated'
          ? {
              previousStatus: previous.status,
              status: current.status,
              outcome: current.outcome!,
              ...(current.reason_code ? { reasonCode: current.reason_code } : {}),
            }
          : {
              previousStatus: previous.status,
              status: current.status,
            } as never,
      });
      return current;
    }).immediate();
  },

  getByAgent(agentId: string, options?: { limit?: number }): InvocationRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare('SELECT * FROM invocation WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(agentId, limit) as InvocationRow[];
  },

  getByConversation(convId: string): InvocationRow[] {
    return getDb()
      .prepare('SELECT * FROM invocation WHERE conversation_id = ? ORDER BY created_at ASC')
      .all(convId) as InvocationRow[];
  },

  getActive(): InvocationRow[] {
    return getDb()
      .prepare("SELECT * FROM invocation WHERE status != 'terminated' ORDER BY created_at ASC")
      .all() as InvocationRow[];
  },

  listRecent(options?: { limit?: number }): InvocationRow[] {
    const limit = options?.limit ?? 50;
    return getDb()
      .prepare('SELECT * FROM invocation ORDER BY created_at DESC LIMIT ?')
      .all(limit) as InvocationRow[];
  },

  updateDispatchStatus(id: string, dispatchStatus: string, extra?: { tokenUsage?: string }): void {
    const db = getDb();
    const now = new Date().toISOString();
    const sets: string[] = ['dispatch_status = ?', 'updated_at = ?'];
    const values: (string | null)[] = [dispatchStatus, now];

    if (extra?.tokenUsage !== undefined) {
      sets.push('token_usage = ?');
      values.push(extra.tokenUsage);
    }

    values.push(id);
    db.prepare(`UPDATE invocation SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  },

  findLatestCompletedForAgent(agentId: string): InvocationRow | undefined {
    const db = getDb();
    return db.prepare(`
      SELECT * FROM invocation
      WHERE agent_id = ? AND status = 'terminated' AND outcome = 'completed'
      ORDER BY created_at DESC LIMIT 1
    `).get(agentId) as InvocationRow | undefined;
  },
};
