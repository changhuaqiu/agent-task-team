import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { getDb } from '../db';
import { CollaborationKernel } from '../collaboration-kernel';
import { generateSortableId } from '../repositories/sortable-id';
import type { TaskWakeup } from './task-wakeup';

interface TaskCommandRejectionRow {
  idempotency_key: string;
  request_digest: string;
  response_json: string;
  recovery_inbox_item_id: string | null;
  created_at: string;
}

export interface TaskEvidenceRejectionReceipt {
  idempotencyKey: string;
  response: { ok: false; error: string };
  wakeup?: TaskWakeup;
  recoveryInboxItemId?: string;
  recordedAt: string;
}

export type TaskEvidenceRecoveryAdmission =
  | { status: 'recorded' | 'replayed'; receipt: TaskEvidenceRejectionReceipt }
  | { status: 'stale'; actualRevision?: number };

export class TaskEvidenceRecoveryIdempotencyConflictError extends Error {
  readonly reasonCode = 'task_evidence_recovery_idempotency_conflict';

  constructor(idempotencyKey: string) {
    super(`task_evidence_recovery_idempotency_conflict:${idempotencyKey}`);
    this.name = 'TaskEvidenceRecoveryIdempotencyConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function requestDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export class TaskEvidenceRecoveryCommand {
  constructor(
    private readonly database?: Database.Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  replay(input: {
    idempotencyKey: string;
    request: unknown;
  }): TaskEvidenceRejectionReceipt | undefined {
    const db = this.database ?? getDb();
    const existing = db.prepare(`
      SELECT idempotency_key,request_digest,response_json,recovery_inbox_item_id,created_at
      FROM task_command_rejection_receipt WHERE idempotency_key=?
    `).get(input.idempotencyKey) as TaskCommandRejectionRow | undefined;
    if (!existing) return undefined;
    if (existing.request_digest !== requestDigest(input.request)) {
      throw new TaskEvidenceRecoveryIdempotencyConflictError(input.idempotencyKey);
    }
    return {
      ...JSON.parse(existing.response_json) as TaskEvidenceRejectionReceipt,
      recoveryInboxItemId: existing.recovery_inbox_item_id ?? undefined,
      recordedAt: existing.created_at,
    };
  }

  admit(input: {
    conversationId: string;
    taskId: string;
    expectedTaskRevision: number;
    idempotencyKey: string;
    request: unknown;
    error: string;
    wakeup?: TaskWakeup;
  }): TaskEvidenceRecoveryAdmission {
    const db = this.database ?? getDb();
    const digest = requestDigest(input.request);

    return db.transaction(() => {
      const existing = db.prepare(`
        SELECT idempotency_key,request_digest,response_json,recovery_inbox_item_id,created_at
        FROM task_command_rejection_receipt WHERE idempotency_key=?
      `).get(input.idempotencyKey) as TaskCommandRejectionRow | undefined;
      if (existing) {
        if (existing.request_digest !== digest) {
          throw new TaskEvidenceRecoveryIdempotencyConflictError(input.idempotencyKey);
        }
        return {
          status: 'replayed' as const,
          receipt: {
            ...JSON.parse(existing.response_json) as TaskEvidenceRejectionReceipt,
            recoveryInboxItemId: existing.recovery_inbox_item_id ?? undefined,
            recordedAt: existing.created_at,
          },
        };
      }

      const task = db.prepare(`
        SELECT conversation_id,revision FROM task WHERE id=?
      `).get(input.taskId) as { conversation_id: string; revision: number } | undefined;
      if (
        !task
        || task.conversation_id !== input.conversationId
        || task.revision !== input.expectedTaskRevision
      ) {
        return { status: 'stale' as const, actualRevision: task?.revision };
      }

      const recoveryInboxItem = input.wakeup
        ? new CollaborationKernel({ db, now: this.now }).request({
            projectId: input.conversationId,
            targetAgentId: input.wakeup.agentId,
            source: 'system',
            requestedAction: input.wakeup.prompt,
            idempotencyKey: `task-evidence-recovery:${input.idempotencyKey}`,
            cause: {
              correlationId: input.idempotencyKey,
              causationId: input.idempotencyKey,
            },
            scope: { taskId: input.taskId },
            context: { scenario: 'recovery' },
            replyTo: { type: 'task', id: input.taskId },
          })
        : undefined;
      const recordedAt = this.now().toISOString();
      const receipt: TaskEvidenceRejectionReceipt = {
        idempotencyKey: input.idempotencyKey,
        response: { ok: false, error: input.error },
        ...(input.wakeup ? { wakeup: input.wakeup } : {}),
        ...(recoveryInboxItem ? { recoveryInboxItemId: recoveryInboxItem.inboxItemId } : {}),
        recordedAt,
      };
      db.prepare(`
        INSERT INTO task_command_rejection_receipt (
          id,idempotency_key,request_digest,command_type,conversation_id,task_id,
          expected_task_revision,response_json,recovery_inbox_item_id,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?)
      `).run(
        generateSortableId('task-command-rejection'),
        input.idempotencyKey,
        digest,
        'task.updateStatus.evidence_rejected',
        input.conversationId,
        input.taskId,
        input.expectedTaskRevision,
        JSON.stringify(receipt),
        recoveryInboxItem?.inboxItemId ?? null,
        recordedAt,
      );
      return { status: 'recorded' as const, receipt };
    }).immediate();
  }
}

export const taskEvidenceRecoveryCommand = new TaskEvidenceRecoveryCommand();
