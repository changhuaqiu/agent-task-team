import type { Server as IOServer } from 'socket.io';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { invocationRepo } from '../repositories/invocation-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo } from '../repositories/task-repo';
import { teamLogProjection } from '../team-log/TeamLogProjection';
import { autonomousDeliveryRepo } from '../autonomous-delivery/repository';
import { qualityGateRepo } from '../quality-gate/repository';
import { resolveAutonomyGuardActions } from '../task-flow/autonomy-guard';
import { requestTaskWakeup } from '../task-flow/task-work-request';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';
import { BlockedRecoveryOwner } from './blocked-recovery-owner';
import { publishProjectView } from '../project-view/project-view-publisher';
import { AgentInbox } from '../platform-events/agent-inbox';

export interface AutonomyGuardOwnerOptions {
  io: IOServer;
  intervalMs?: number;
  now?: () => number;
}

/**
 * Server-side workflow owner for recovery and closure wakeups. This module may
 * share a process with a daemon, but it never runs inside the execution adapter
 * and the daemon does not reinterpret tasks, gates, or graph policy.
 */
export class AutonomyGuardOwner {
  private readonly io: IOServer;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly publishedAt = new Map<string, number>();
  private lastTeamLogArchiveSweepAt = 0;
  private timer?: NodeJS.Timeout;
  private readonly blockedRecovery = new BlockedRecoveryOwner();

  constructor(options: AutonomyGuardOwnerOptions) {
    this.io = options.io;
    this.intervalMs = options.intervalMs
      ?? Number(process.env.AUTONOMY_GUARD_INTERVAL_MS || 60_000);
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  runOnce(): void {
    const now = this.now();
    try {
      this.blockedRecovery.runOnce();
    } catch (error) {
      console.warn('[autonomy-guard] blocked recovery sweep failed:', error);
    }
    for (const [key, timestamp] of this.publishedAt) {
      if (now - timestamp > 2 * 60 * 1000) this.publishedAt.delete(key);
    }

    const tasks = taskRepo.list();
    const conversationIds = Array.from(new Set(tasks.map((task) => task.conversation_id)));
    if (now - this.lastTeamLogArchiveSweepAt >= 24 * 60 * 60 * 1000) {
      for (const conversationId of conversationIds) {
        try {
          teamLogProjection.materializeRegistered(conversationId);
        } catch (error) {
          console.warn(`[team-log] daily archive sweep failed for ${conversationId}:`, error);
        }
      }
      this.lastTeamLogArchiveSweepAt = now;
    }

    for (const conversationId of conversationIds) {
      const conversationTasks = tasks.filter((task) => task.conversation_id === conversationId);
      const audience = resolveTaskNotificationAudience(conversationId);
      const closureProofs = proofLogRepo.findByType({
        eventType: 'chain_closure_dispatched',
        conversationId,
        reasonCode: 'chain_ready_for_closure',
      });
      const delivery = autonomousDeliveryRepo.getLatestByConversation(conversationId);
      const deliveryCanOwnEscalation = Boolean(
        delivery && ['active', 'waiting_gate', 'retrying'].includes(delivery.run.status),
      );
      const reviewableTaskIds = conversationTasks
        .filter((task) => {
          const gate = qualityGateRepo.listForTarget('task', task.id).at(-1);
          return gate
            && gate.artifact_revision === String(task.revision)
            && (gate.status === 'requested' || gate.status === 'evaluating');
        })
        .map((task) => task.id);
      const actions = resolveAutonomyGuardActions({
        tasks: conversationTasks,
        envelopes: executionEnvelopeRepo.listByConversation(conversationId),
        invocations: invocationRepo.listByConversation(conversationId),
        pendingTaskDispatchIds: new AgentInbox().listPending(conversationId)
          .map((item) => item.command.taskId)
          .filter((taskId): taskId is string => Boolean(taskId)),
        coordinatorAgentIds: audience.coordinatorAgentIds,
        reviewAgentIds: audience.reviewGateAgentIds,
        qaAgentIds: audience.qaAgentIds,
        edges: taskGraphRepo.listEdges(conversationId),
        closureDispatchedRootTaskIds: closureProofs
          .map((proof) => proof.task_id)
          .filter((taskId): taskId is string => Boolean(taskId)),
        maxAttemptsPerTaskAgent: delivery?.contract.recoveryPolicy.maxAttemptsPerAction ?? 3,
        retryBudgetEscalationAvailable: deliveryCanOwnEscalation,
        attemptWindowStartedAt: delivery?.run.updated_at,
        reviewableTaskIds,
      });
      if (
        actions.escalations.length > 0
        && delivery
        && deliveryCanOwnEscalation
      ) {
        const escalation = actions.escalations[0];
        autonomousDeliveryRepo.transitionRun({
          runId: delivery.run.id,
          to: 'waiting_human',
          stage: escalation.taskStatus === 'in_review' ? 'reviewing' : delivery.run.current_stage,
          expectedRevision: delivery.run.revision,
          escalationCode: 'runtime_retry_budget_exhausted',
          escalationDetail: [
            `任务 ${escalation.taskId} 调用 ${escalation.agentId} 连续失败 ${escalation.attempts} 次，已停止自动重试。`,
            escalation.lastReasonCode ? `最近原因：${escalation.lastReasonCode}` : '',
          ].filter(Boolean).join(' '),
          actor: { type: 'system', id: 'autonomy-guard' },
          eventIdempotencyKey: `autonomy-guard:retry-budget:${escalation.taskId}:${escalation.agentId}:${delivery.run.revision}`,
          now: new Date(now),
        });
        continue;
      }
      for (const wakeup of actions.wakeups) this.publish(wakeup, now);
    }
  }

  private publish(
    wakeup: ReturnType<typeof resolveAutonomyGuardActions>['wakeups'][number],
    now: number,
  ): void {
    const key = wakeup.metadata.idempotencyKey;
    if (this.publishedAt.has(key)) return;
    this.publishedAt.set(key, now);
    proofLogRepo.append({
      eventType: 'autonomy_guard.wakeup',
      conversationId: wakeup.conversationId,
      taskId: wakeup.taskId,
      agentId: wakeup.agentId,
      reasonCode: wakeup.reasonCode,
      metadata: {
        dispatchSource: wakeup.dispatchSource,
        idempotencyKey: key,
      },
    });
    requestTaskWakeup(wakeup);
    if (
      wakeup.reasonCode === 'chain_ready_for_closure'
    ) {
      proofLogRepo.append({
        eventType: 'chain_closure_dispatched',
        conversationId: wakeup.conversationId,
        taskId: wakeup.metadata.rootTaskId ?? wakeup.taskId,
        agentId: wakeup.agentId,
        reasonCode: wakeup.reasonCode,
        metadata: {
          idempotencyKey: key,
          subtreeSize: wakeup.metadata.subtreeSize,
          partial: wakeup.metadata.partial,
        },
      });
    }
    const eventId = `wakeup-${now}-${Math.random().toString(36).slice(2, 8)}`;
    publishProjectView(this.io, wakeup.conversationId, {
      type: 'task.wakeup',
      delivery: 'durable',
      actor: { type: 'system', id: 'autonomy-guard' },
      subject: { type: 'task', id: wakeup.taskId },
      eventId,
      correlationId: wakeup.metadata.idempotencyKey,
      causationId: wakeup.metadata.idempotencyKey,
      occurredAt: new Date(now).toISOString(),
      payload: { ...wakeup, id: eventId, createdAt: new Date(now).toISOString() },
    });
  }
}
