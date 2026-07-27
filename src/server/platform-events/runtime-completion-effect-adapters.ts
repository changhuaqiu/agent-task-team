import type { Server as IOServer } from 'socket.io';
import { agentEvaluation } from '../evaluation/agent-evaluation';
import { proofLogRepo } from '../repositories/proof-log-repo';
import { syncTasksToDb } from '../task-file-watcher';
import { teamLogProjection } from '../team-log/TeamLogProjection';
import type { DurableEffectOutbox } from './durable-effect-outbox';
import { registerRuntimeCompletionEffectAdapters } from './runtime-completion-effects';

export interface ProductionRuntimeCompletionEffectOptions {
  io: IOServer;
}

export function registerProductionRuntimeCompletionEffects(
  outbox: DurableEffectOutbox,
  options: ProductionRuntimeCompletionEffectOptions,
): void {
  registerRuntimeCompletionEffectAdapters(outbox, {
    syncTasks(payload) {
      syncTasksToDb(
        payload.projectDir,
        payload.conversationId,
        options.io,
        { throwOnError: true },
      );
    },
    recordInvalidExit(payload) {
      proofLogRepo.append({
        eventType: 'no_valid_exit',
        conversationId: payload.conversationId,
        taskId: payload.taskId,
        chainId: payload.chainId,
        passId: payload.passId,
        agentId: payload.agentId,
        reasonCode: payload.reasonCode,
        metadata: {
          scenario: payload.scenario,
          outcomeSummary: payload.outcomeSummary,
        },
      });
    },
    queueClosureEvaluation(payload) {
      const closureProof = proofLogRepo.findByType({
        eventType: 'chain_closure_dispatched',
        conversationId: payload.conversationId,
        taskId: payload.taskId,
      }).at(-1);
      const triggerId = closureProof?.id
        ?? `closure:${payload.conversationId}:${payload.taskId}:${payload.chainId ?? 'no-chain'}`;
      const sampling = agentEvaluation.shouldEvaluateClosure(payload.conversationId, triggerId);
      if (!sampling.allowed) {
        proofLogRepo.append({
          eventType: 'eval.skipped',
          conversationId: payload.conversationId,
          taskId: payload.taskId,
          chainId: payload.chainId,
          reasonCode: sampling.reason,
          metadata: { triggerId },
        });
        return { queued: false };
      }
      const submitted = agentEvaluation.submit({
        conversationId: payload.conversationId,
        triggerId,
        rootTaskId: payload.taskId,
        chainId: payload.chainId,
        evidenceCutoffAt: payload.evidenceCutoffAt,
        mode: 'online',
      });
      return {
        runId: submitted.runId,
        queued: !submitted.duplicate,
      };
    },
    notifyEvaluationQueued(payload, runId) {
      options.io.to(payload.conversationId).emit('evaluation:queued', {
        projectId: payload.conversationId,
        conversationId: payload.conversationId,
        runId,
      });
    },
    updateTeamLog(payload) {
      if (payload.upToEntryId) {
        teamLogProjection.markConsumed(
          payload.conversationId,
          payload.agentId,
          payload.upToEntryId,
        );
      }
      teamLogProjection.materializeRegistered(payload.conversationId);
    },
  });
}
