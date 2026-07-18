import { describe, expect, it } from 'vitest';
import { resolveScenario } from './scenarioResolver';

describe('resolveScenario', () => {
  it.each([
    [{ trigger: 'user_turn' as const, isFirstWake: true }, 'init'],
    [{ trigger: 'user_turn' as const, isFirstWake: false }, 'iterate'],
    [{ trigger: 'a2a_handoff' as const, isFirstWake: true }, 'init'],
    [{ trigger: 'resume' as const, isFirstWake: true, wakeup: { reasonCode: 'owner_ready' } }, 'wakeup'],
    [{ trigger: 'resume' as const, isFirstWake: false, wakeup: { reasonCode: 'chain_ready_for_closure' } }, 'closure'],
  ])('resolves %o as %s', (input, expected) => {
    expect(resolveScenario(input)).toBe(expected);
  });

  it('treats resume without metadata as wakeup', () => {
    expect(resolveScenario({ trigger: 'resume', isFirstWake: false })).toBe('wakeup');
  });
});
