import { describe, expect, it } from 'vitest';
import type { RuntimeCompletionContext } from './runtime-completion-process-manager';
import {
  planRuntimeCompletionEffects,
  RUNTIME_COMPLETION_EFFECT_TYPES,
} from './runtime-completion-effects';
import type { PlatformEvent } from './types';

function context(overrides: Partial<RuntimeCompletionContext> = {}): RuntimeCompletionContext {
  return {
    invocation_id: 'inv-1',
    conversation_id: 'project-1',
    agent_id: 'implementer',
    task_id: 'task-1',
    chain_id: 'chain-1',
    pass_id: null,
    context_scenario: 'closure',
    team_log_up_to_entry_id: 'entry-4',
    task_project_dir: 'C:\\workspace\\project-1',
    evaluation_execution_id: null,
    source_event_id: 'event-terminal',
    status: 'pending',
    ...overrides,
  };
}

const terminal = {
  eventId: 'event-terminal',
  type: 'runtime.invocation.terminated',
  category: 'runtime_lifecycle',
  schemaVersion: 1,
  projectId: 'project-1',
  streamKey: 'invocation:inv-1',
  streamSequence: 4,
  aggregate: { type: 'invocation', id: 'inv-1' },
  actor: { type: 'runtime', id: 'daemon' },
  invocationId: 'inv-1',
  correlationId: 'trace-1',
  occurredAt: '2026-07-25T08:00:00.000Z',
  recordedAt: '2026-07-25T08:00:01.000Z',
  payload: { outcome: 'completed', durationMs: 1 },
} satisfies PlatformEvent;

describe('planRuntimeCompletionEffects', () => {
  it('plans a valid closure in deterministic lane order', () => {
    const effects = planRuntimeCompletionEffects(
      context(),
      'GOAL: done\nDELIVERED: implementation\nNOT DONE: none',
      terminal,
    );

    expect(effects.map((effect) => effect.type)).toEqual([
      RUNTIME_COMPLETION_EFFECT_TYPES.taskSync,
      RUNTIME_COMPLETION_EFFECT_TYPES.closureEvaluation,
      RUNTIME_COMPLETION_EFFECT_TYPES.teamLog,
    ]);
    expect(effects[1]?.payload).toMatchObject({
      evidenceCutoffAt: terminal.occurredAt,
      taskId: 'task-1',
      chainId: 'chain-1',
    });
  });

  it('records an invalid exit instead of scheduling closure evaluation', () => {
    const effects = planRuntimeCompletionEffects(context(), '收到', terminal);

    expect(effects.map((effect) => effect.type)).toEqual([
      RUNTIME_COMPLETION_EFFECT_TYPES.taskSync,
      RUNTIME_COMPLETION_EFFECT_TYPES.validExitProof,
      RUNTIME_COMPLETION_EFFECT_TYPES.teamLog,
    ]);
    expect(effects[1]?.payload).toMatchObject({
      reasonCode: 'placeholder',
      outcomeSummary: '收到',
    });
  });

  it('omits production effects for held-out evaluation execution', () => {
    expect(planRuntimeCompletionEffects(
      context({ evaluation_execution_id: 'execution-1' }),
      'held-out output',
      terminal,
    )).toEqual([]);
  });
});
