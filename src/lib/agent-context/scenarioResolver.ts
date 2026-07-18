import type { ContextRequest } from './ContextManager';

export type ContextScenario = 'init' | 'iterate' | 'handoff' | 'wakeup' | 'closure';

export function resolveScenario(req: Pick<ContextRequest, 'trigger' | 'isFirstWake' | 'wakeup'>): ContextScenario {
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
