import crypto from 'node:crypto';
import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';
import { generateSortableId } from './sortable-id';
import type {
  DispatchIntent,
  DispatchSource,
  ExecutionEnvelopePayload,
  ExecutionEnvelopeStatus,
} from './control-plane-types';

const EXECUTION_ENVELOPE_TRANSITIONS: Readonly<
  Record<ExecutionEnvelopeStatus, ReadonlySet<ExecutionEnvelopeStatus>>
> = {
  drafted: new Set(['validated', 'rejected', 'expired']),
  validated: new Set(['routed', 'rejected', 'expired']),
  routed: new Set(['sent', 'rejected', 'expired']),
  sent: new Set(['acknowledged', 'rejected', 'expired']),
  acknowledged: new Set(),
  rejected: new Set(),
  expired: new Set(),
};

export interface ExecutionEnvelopeRow {
  id: string;
  source: DispatchSource;
  intent: DispatchIntent;
  conversation_id: string;
  task_id: string | null;
  chain_id: string | null;
  pass_id: string | null;
  from_node_id: string;
  from_agent_id: string | null;
  to_node_id: string;
  to_agent_id: string;
  payload: string;
  ttl_ms: number;
  nonce: string;
  status: ExecutionEnvelopeStatus;
  reason_code: string | null;
  settled_at: string | null;
  revision: number;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface CreateExecutionEnvelopeInput {
  source: DispatchSource;
  intent: DispatchIntent;
  conversationId: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  fromNodeId: string;
  fromAgentId?: string;
  toNodeId: string;
  toAgentId: string;
  payload?: ExecutionEnvelopePayload;
  ttlMs?: number;
}

export interface ExecutionEnvelopeTransition {
  to: ExecutionEnvelopeStatus;
  expectedFrom?: ExecutionEnvelopeStatus;
  reasonCode?: string;
}

class InvalidExecutionEnvelopeTransitionError extends Error {
  readonly reasonCode = 'invalid_execution_envelope_transition';

  constructor(
    readonly envelopeId: string,
    readonly from: ExecutionEnvelopeStatus,
    readonly to: ExecutionEnvelopeStatus,
  ) {
    super(`Illegal execution envelope transition for ${envelopeId}: ${from} -> ${to}`);
  }
}

class StaleExecutionEnvelopeTransitionError extends Error {
  readonly reasonCode = 'stale_execution_envelope_transition';

  constructor(
    readonly envelopeId: string,
    readonly expected: ExecutionEnvelopeStatus,
    readonly actual: ExecutionEnvelopeStatus,
  ) {
    super(`Stale execution envelope transition for ${envelopeId}: expected ${expected}, found ${actual}`);
  }
}

class InvalidExecutionEnvelopeReasonError extends Error {
  readonly reasonCode = 'invalid_execution_envelope_reason';

  constructor(readonly status: ExecutionEnvelopeStatus) {
    super(`Execution envelope ${status} requires a reasonCode`);
  }
}

export const executionEnvelopeRepo = {
  create(input: CreateExecutionEnvelopeInput): ExecutionEnvelopeRow {
    const id = generateSortableId('env');
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const ttlMs = input.ttlMs ?? 120_000;
    const expiresAt = new Date(nowMs + ttlMs).toISOString();
    const db = getDb();
    return db.transaction(() => {
      db.prepare(
        `INSERT INTO execution_envelope (
          id, source, intent, conversation_id, task_id, chain_id, pass_id,
          from_node_id, from_agent_id, to_node_id, to_agent_id, payload,
          ttl_ms, nonce, status, revision, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', 0, ?, ?, ?)`,
      )
      .run(
        id,
        input.source,
        input.intent,
        input.conversationId,
        input.taskId ?? null,
        input.chainId ?? null,
        input.passId ?? null,
        input.fromNodeId,
        input.fromAgentId ?? null,
        input.toNodeId,
        input.toAgentId,
        JSON.stringify(input.payload ?? { contextRefs: [] }),
        ttlMs,
        crypto.randomBytes(12).toString('hex'),
        expiresAt,
        now,
        now,
      );
      new DomainEventPublisher(db).publish({
        type: 'envelope.drafted',
        projectId: input.conversationId,
        aggregate: { type: 'envelope', id, version: 0 },
        projectAgentId: input.toAgentId,
        occurredAt: now,
        payload: { status: 'drafted' },
      });
      return executionEnvelopeRepo.getById(id)!;
    }).immediate();
  },

  getById(id: string): ExecutionEnvelopeRow | undefined {
    return getDb()
      .prepare('SELECT * FROM execution_envelope WHERE id = ?')
      .get(id) as ExecutionEnvelopeRow | undefined;
  },

  listByConversation(conversationId: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare('SELECT * FROM execution_envelope WHERE conversation_id = ? ORDER BY created_at ASC, id ASC')
      .all(conversationId) as ExecutionEnvelopeRow[];
  },

  listRunnableForNode(nodeId: string): ExecutionEnvelopeRow[] {
    return getDb()
      .prepare(
        `SELECT * FROM execution_envelope
         WHERE to_node_id = ? AND status IN ('validated', 'routed', 'sent')
         ORDER BY created_at ASC, id ASC`,
      )
      .all(nodeId) as ExecutionEnvelopeRow[];
  },

  transition(
    id: string,
    transition: ExecutionEnvelopeTransition,
  ): ExecutionEnvelopeRow | undefined {
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = executionEnvelopeRepo.getById(id);
      if (!previous) return undefined;
      if (transition.expectedFrom && transition.expectedFrom !== previous.status) {
        throw new StaleExecutionEnvelopeTransitionError(
          id,
          transition.expectedFrom,
          previous.status,
        );
      }
      if (previous.status === transition.to) return previous;
      if (!EXECUTION_ENVELOPE_TRANSITIONS[previous.status].has(transition.to)) {
        throw new InvalidExecutionEnvelopeTransitionError(id, previous.status, transition.to);
      }
      if (transition.to === 'rejected' && !transition.reasonCode?.trim()) {
        throw new InvalidExecutionEnvelopeReasonError(transition.to);
      }
      const terminal = ['acknowledged', 'rejected', 'expired'].includes(transition.to);
      const result = db
        .prepare(`
          UPDATE execution_envelope
          SET status = ?, reason_code = ?, settled_at = ?, revision = revision + 1, updated_at = ?
          WHERE id = ? AND status = ?
        `)
        .run(
          transition.to,
          transition.reasonCode ?? null,
          terminal ? now : null,
          now,
          id,
          previous.status,
        );
      if (result.changes !== 1) {
        const current = executionEnvelopeRepo.getById(id);
        if (current) {
          throw new StaleExecutionEnvelopeTransitionError(id, previous.status, current.status);
        }
        return undefined;
      }
      const current = executionEnvelopeRepo.getById(id)!;
      const type = `envelope.${current.status}` as const;
      new DomainEventPublisher(db).publish({
        type,
        projectId: current.conversation_id,
        aggregate: { type: 'envelope', id, version: current.revision },
        projectAgentId: current.to_agent_id,
        occurredAt: now,
        payload: current.status === 'rejected'
          ? {
            previousStatus: previous.status,
            status: current.status,
            reasonCode: current.reason_code!,
          }
          : {
              previousStatus: previous.status,
              status: current.status,
            } as never,
      });
      return current;
    }).immediate();
  },

  expireStale(now = new Date()): number {
    const current = now.toISOString();
    const db = getDb();
    return db.transaction(() => {
      const expired = db.prepare(
        `SELECT id FROM execution_envelope
         WHERE expires_at < ? AND status NOT IN ('acknowledged', 'rejected', 'expired')`,
      ).all(current) as Array<{ id: string }>;
      let changed = 0;
      for (const row of expired) {
        const envelope = executionEnvelopeRepo.getById(row.id);
        if (!envelope) continue;
        if (executionEnvelopeRepo.transition(row.id, {
          to: 'expired',
          expectedFrom: envelope.status,
          reasonCode: envelope.status === 'sent' ? 'ack_timeout' : 'dispatch_ttl_expired',
        })) changed += 1;
      }
      return changed;
    }).immediate();
  },
};
