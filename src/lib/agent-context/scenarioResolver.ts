import type { ContextRequest } from './ContextManager';

export type ContextScenario =
  // Compatibility scenarios used by current dispatch callers.
  | 'init'
  | 'iterate'
  | 'wakeup'
  // Team Harness scenarios. New callers should prefer these semantic names.
  | 'goal_intake'
  | 'planning'
  | 'architecture_review'
  | 'execution'
  | 'handoff'
  | 'code_review'
  | 'verification'
  | 'recovery'
  | 'closure'
  | 'escalation';

export function resolveScenario(
  req: Pick<ContextRequest, 'scenario' | 'trigger' | 'isFirstWake' | 'wakeup'>,
): ContextScenario {
  if (req.scenario) return req.scenario;
  // Trigger describes where the input came from; first-wake describes the
  // bootstrap requirement. A first A2A handoff still carries its handoff
  // artifact, but must receive identity before ordinary handoff omission rules.
  if (req.isFirstWake && req.trigger !== 'resume') return 'init';
  if (req.trigger === 'a2a_handoff') return 'handoff';
  if (req.trigger === 'resume') {
    return req.wakeup?.reasonCode === 'chain_ready_for_closure' ? 'closure' : 'wakeup';
  }
  return 'iterate';
}
