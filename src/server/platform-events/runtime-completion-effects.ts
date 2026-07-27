import type { ContextScenario } from '../../lib/agent-context/scenarioResolver';
import { checkValidExit } from '../harness/valid-exit';
import type {
  DurableEffect,
  DurableEffectOutbox,
  EnqueueDurableEffect,
} from './durable-effect-outbox';
import type { RuntimeCompletionContext } from './runtime-completion-process-manager';
import type { PlatformEvent } from './types';

export const RUNTIME_COMPLETION_EFFECT_TYPES = {
  taskSync: 'runtime.task_sync',
  validExitProof: 'runtime.valid_exit_proof',
  closureEvaluation: 'runtime.closure_evaluation',
  teamLog: 'runtime.team_log',
} as const;

export interface RuntimeTaskSyncEffectPayload {
  invocationId: string;
  projectDir: string;
  conversationId: string;
}

export interface RuntimeValidExitProofEffectPayload {
  invocationId: string;
  conversationId: string;
  taskId?: string;
  chainId?: string;
  passId?: string;
  agentId: string;
  scenario: ContextScenario;
  reasonCode: string;
  outcomeSummary: string;
}

export interface RuntimeClosureEvaluationEffectPayload {
  invocationId: string;
  conversationId: string;
  taskId: string;
  chainId?: string;
  evidenceCutoffAt: string;
}

export interface RuntimeTeamLogEffectPayload {
  invocationId: string;
  conversationId: string;
  agentId: string;
  upToEntryId?: string;
}

export interface RuntimeCompletionEffectPayloadMap {
  'runtime.task_sync': RuntimeTaskSyncEffectPayload;
  'runtime.valid_exit_proof': RuntimeValidExitProofEffectPayload;
  'runtime.closure_evaluation': RuntimeClosureEvaluationEffectPayload;
  'runtime.team_log': RuntimeTeamLogEffectPayload;
}

export interface RuntimeClosureEvaluationResult {
  runId?: string;
  queued: boolean;
}

export interface RuntimeCompletionEffectAdapters {
  syncTasks(payload: RuntimeTaskSyncEffectPayload, idempotencyKey: string): void | Promise<void>;
  recordInvalidExit(payload: RuntimeValidExitProofEffectPayload): void;
  queueClosureEvaluation(payload: RuntimeClosureEvaluationEffectPayload): RuntimeClosureEvaluationResult;
  notifyEvaluationQueued(payload: RuntimeClosureEvaluationEffectPayload, runId: string): void;
  updateTeamLog(
    payload: RuntimeTeamLogEffectPayload,
    idempotencyKey: string,
  ): void | Promise<void>;
}

function effect<TType extends keyof RuntimeCompletionEffectPayloadMap>(
  type: TType,
  invocationId: string,
  payload: RuntimeCompletionEffectPayloadMap[TType],
): EnqueueDurableEffect {
  return { type, targetKey: invocationId, payload };
}

export function planRuntimeCompletionEffects(
  context: RuntimeCompletionContext,
  output: string,
  terminal: PlatformEvent,
): EnqueueDurableEffect[] {
  if (context.evaluation_execution_id) return [];
  const invocationId = context.invocation_id;
  const effects: EnqueueDurableEffect[] = [
    effect(RUNTIME_COMPLETION_EFFECT_TYPES.taskSync, invocationId, {
      invocationId,
      projectDir: context.task_project_dir,
      conversationId: context.conversation_id,
    }),
  ];
  const scenario = context.context_scenario as ContextScenario | null;
  let validExit = true;
  if (scenario) {
    const exit = checkValidExit(scenario, output);
    validExit = exit.valid;
    if (!exit.valid) {
      effects.push(effect(RUNTIME_COMPLETION_EFFECT_TYPES.validExitProof, invocationId, {
        invocationId,
        conversationId: context.conversation_id,
        ...(context.task_id ? { taskId: context.task_id } : {}),
        ...(context.chain_id ? { chainId: context.chain_id } : {}),
        ...(context.pass_id ? { passId: context.pass_id } : {}),
        agentId: context.agent_id,
        scenario,
        reasonCode: exit.reason,
        outcomeSummary: output.slice(0, 200),
      }));
    }
  }
  if (scenario === 'closure' && validExit && context.task_id) {
    effects.push(effect(RUNTIME_COMPLETION_EFFECT_TYPES.closureEvaluation, invocationId, {
      invocationId,
      conversationId: context.conversation_id,
      taskId: context.task_id,
      ...(context.chain_id ? { chainId: context.chain_id } : {}),
      evidenceCutoffAt: terminal.occurredAt,
    }));
  }
  effects.push(effect(RUNTIME_COMPLETION_EFFECT_TYPES.teamLog, invocationId, {
    invocationId,
    conversationId: context.conversation_id,
    agentId: context.agent_id,
    ...(context.team_log_up_to_entry_id
      ? { upToEntryId: context.team_log_up_to_entry_id }
      : {}),
  }));
  return effects;
}

function payload<TType extends keyof RuntimeCompletionEffectPayloadMap>(
  command: DurableEffect,
): RuntimeCompletionEffectPayloadMap[TType] {
  return command.payload as RuntimeCompletionEffectPayloadMap[TType];
}

export function registerRuntimeCompletionEffectAdapters(
  outbox: DurableEffectOutbox,
  adapters: RuntimeCompletionEffectAdapters,
): void {
  outbox.register({
    type: RUNTIME_COMPLETION_EFFECT_TYPES.taskSync,
    execution: 'idempotent',
    timeoutMs: 30_000,
    execute(command, context) {
      if (context.signal.aborted) throw context.signal.reason ?? new Error('task_sync_aborted');
      return adapters.syncTasks(
        payload<'runtime.task_sync'>(command),
        context.idempotencyKey,
      );
    },
  });
  outbox.register({
    type: RUNTIME_COMPLETION_EFFECT_TYPES.validExitProof,
    execution: 'transactional',
    execute(command) {
      adapters.recordInvalidExit(payload<'runtime.valid_exit_proof'>(command));
    },
  });
  outbox.register({
    type: RUNTIME_COMPLETION_EFFECT_TYPES.closureEvaluation,
    execution: 'transactional',
    execute(command) {
      const input = payload<'runtime.closure_evaluation'>(command);
      const result = adapters.queueClosureEvaluation(input);
      if (!result.queued || !result.runId) return;
      return {
        afterCommit: () => adapters.notifyEvaluationQueued(input, result.runId!),
      };
    },
  });
  outbox.register({
    type: RUNTIME_COMPLETION_EFFECT_TYPES.teamLog,
    execution: 'idempotent',
    execute(command, context) {
      if (context.signal.aborted) throw context.signal.reason ?? new Error('team_log_aborted');
      return adapters.updateTeamLog(
        payload<'runtime.team_log'>(command),
        context.idempotencyKey,
      );
    },
  });
}
