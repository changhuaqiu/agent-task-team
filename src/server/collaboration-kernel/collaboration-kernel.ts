import type Database from 'better-sqlite3';
import {
  AgentInbox,
  type AgentInboxOptions,
  type AgentWorkCommand,
} from '../platform-events/agent-inbox';
import type {
  CollaborationReplyAddress,
  WorkCancellation,
  WorkRequest,
  WorkRequestReceipt,
} from './types';

export interface CollaborationKernelOptions {
  db?: Database.Database;
  inbox?: AgentInbox;
  now?: AgentInboxOptions['now'];
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`collaboration_${field}_required`);
  return normalized;
}

function normalizeReplyTo(replyTo: CollaborationReplyAddress): CollaborationReplyAddress {
  return { ...replyTo, id: required(replyTo.id, 'reply_to_id') };
}

/**
 * Sole domain-facing seam for durable Agent work. Callers describe intent and
 * ownership; Inbox commands, lane identity and runtime-oriented fields remain
 * inside this deep module.
 */
export class CollaborationKernel {
  private readonly inbox: AgentInbox;

  constructor(options: CollaborationKernelOptions = {}) {
    this.inbox = options.inbox ?? new AgentInbox({ db: options.db, now: options.now });
  }

  request(input: WorkRequest): WorkRequestReceipt {
    const projectId = required(input.projectId, 'project_id');
    const targetAgentId = required(input.targetAgentId, 'target_agent_id');
    const requestedAction = required(input.requestedAction, 'requested_action');
    const idempotencyKey = required(input.idempotencyKey, 'idempotency_key');
    const correlationId = required(input.cause.correlationId, 'correlation_id');
    const replyTo = normalizeReplyTo(input.replyTo);
    if (input.cause.event && input.cause.event.projectId !== projectId) {
      throw new Error('collaboration_cause_event_project_mismatch');
    }
    const requestId = `work-request:${projectId}:${targetAgentId}:${idempotencyKey}`;
    const laneId = `${projectId}:${targetAgentId}`;
    const command: AgentWorkCommand = {
      requestId,
      laneId,
      replyTo,
      source: input.source,
      prompt: requestedAction,
      correlationId,
      causationId: input.cause.causationId,
      workId: input.scope?.workId,
      executionMode: input.scope?.executionMode,
      taskId: input.scope?.taskId,
      deliveryRunId: input.scope?.deliveryRunId,
      fromAgentId: input.collaboration?.fromAgentId,
      chainId: input.collaboration?.chainId,
      passId: input.collaboration?.passId,
      possessionId: input.collaboration?.possession?.id,
      possessionRevision: input.collaboration?.possession?.revision,
      a2aHandoff: input.context?.handoff,
      contextScenario: input.context?.scenario,
      wakeup: input.context?.wakeup,
      evaluation: input.context?.evaluation,
      legacyProposal: input.policy?.rejectIfDeliveryOwned,
    };
    const item = this.inbox.enqueue({
      projectId,
      projectAgentId: targetAgentId,
      idempotencyKey,
      sourceEvent: input.cause.event,
      command,
    });
    return {
      requestId,
      inboxItemId: item.id,
      laneId,
      projectId,
      targetAgentId,
      replyTo,
    };
  }

  cancel(input: WorkCancellation): number {
    if (input.kind === 'request') {
      return this.inbox.cancelPending(
        input.projectId,
        input.targetAgentId,
        input.idempotencyKey,
      );
    }
    if (input.kind === 'task') {
      return input.includeClaimed
        ? this.inbox.cancelForTerminalTask(input.projectId, input.taskId)
        : this.inbox.cancelPendingForTask(input.projectId, input.taskId);
    }
    if (input.kind === 'delivery') {
      return this.inbox.cancelForTerminalDelivery(input.projectId, input.deliveryRunId);
    }
    if (input.kind === 'a2a_chain') {
      return this.inbox.cancelPendingForChain(input.projectId, input.chainId);
    }
    return this.inbox.cancelPendingForWorkIds(
      input.projectId,
      input.workIds,
      input.reasonCode,
    );
  }
}
