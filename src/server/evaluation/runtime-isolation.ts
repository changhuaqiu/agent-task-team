import type { StreamTextPersistenceSink } from '../agent/streamTextPersistence';
import type { HarnessDispatchPlan } from '../harness';

type EvaluationExecution = HarnessDispatchPlan['evaluation'];

/**
 * Keeps held-out output in the response/observation evidence path without
 * inserting it into the production conversation message stream.
 */
export function evaluationSafeTextSink(
  evaluation: EvaluationExecution,
  productionSink: StreamTextPersistenceSink,
): StreamTextPersistenceSink {
  if (!evaluation) return productionSink;
  return {
    create: () => `evaluation:${evaluation.executionId}`,
    append: () => true,
  };
}

/** Production collaboration projections must never consume held-out output. */
export function allowsProductionCollaborationEffects(evaluation: EvaluationExecution): boolean {
  return !evaluation;
}
