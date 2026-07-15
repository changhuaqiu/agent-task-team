import type { ContextRequest } from './ContextManager';

export type ContextScenario = 'init' | 'iterate' | 'handoff' | 'wakeup' | 'closure';

export function resolveScenario(req: Pick<ContextRequest, 'trigger' | 'isFirstWake' | 'wakeup'>): ContextScenario {
  if (req.trigger === 'a2a_handoff') return 'handoff';
  if (req.trigger === 'resume') {
    return req.wakeup?.reasonCode === 'chain_ready_for_closure' ? 'closure' : 'wakeup';
  }
  return req.isFirstWake ? 'init' : 'iterate';
}
