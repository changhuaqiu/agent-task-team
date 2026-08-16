import type { Server as IOServer } from 'socket.io';
import { executionEnvelopeRepo } from '../repositories/execution-envelope-repo';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { taskGraphRepo } from '../repositories/task-graph-repo';
import { taskRepo } from '../repositories/task-repo';
import { submitTaskWakeupToInvocationPipeline } from '../invocation-pipeline';
import { teamLogProjection } from '../team-log/TeamLogProjection';
import { resolveAutonomyGuardWakeups } from '../task-flow/autonomy-guard';
import { resolveTaskNotificationAudience } from '../task-flow/task-notification-publisher';

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
      const wakeups = resolveAutonomyGuardWakeups({
        tasks: conversationTasks,
        envelopes: executionEnvelopeRepo.listByConversation(conversationId),
        coordinatorAgentIds: audience.coordinatorAgentIds,
        reviewAgentIds: audience.reviewGateAgentIds,
        qaAgentIds: audience.qaAgentIds,
        edges: taskGraphRepo.listEdges(conversationId),
        closureDispatchedRootTaskIds: closureProofs
          .map((proof) => proof.task_id)
          .filter((taskId): taskId is string => Boolean(taskId)),
      });
      for (const wakeup of wakeups) this.publish(wakeup, now);
    }
  }

  private publish(
    wakeup: ReturnType<typeof resolveAutonomyGuardWakeups>[number],
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
    const submission = submitTaskWakeupToInvocationPipeline(this.io, wakeup);
    if (
      wakeup.reasonCode === 'chain_ready_for_closure'
      && submission?.handled
      && submission.disposition === 'accepted'
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
    this.io.to(wakeup.conversationId).emit('task.wakeup', {
      ...wakeup,
      projectId: wakeup.conversationId,
      id: `wakeup-${now}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(now).toISOString(),
    });
  }
}
