import { describe, expect, it } from 'vitest';
import { getDirective, INJECTION_POLICY } from './injectionPolicy';
import type { ContextScenario } from './scenarioResolver';

describe('injection policy', () => {
  it('is total for every scenario, archetype and cluster', () => {
    const scenarios: ContextScenario[] = ['init', 'iterate', 'handoff', 'wakeup', 'closure'];
    const archetypes = ['planner', 'reviewer', 'worker'] as const;
    const clusters = ['identity', 'protocol', 'capability', 'situation', 'focus', 'dialog'] as const;
    for (const scenario of scenarios) {
      for (const archetype of archetypes) {
        for (const cluster of clusters) {
          expect(['include', 'omit']).toContain(getDirective(scenario, archetype, cluster));
        }
      }
    }
    expect(Object.keys(INJECTION_POLICY)).toHaveLength(5);
  });

  it('omits dialog for handoff and wakeup but includes focus', () => {
    expect(getDirective('handoff', 'worker', 'dialog')).toBe('omit');
    expect(getDirective('wakeup', 'reviewer', 'dialog')).toBe('omit');
    expect(getDirective('handoff', 'worker', 'focus')).toBe('include');
    expect(getDirective('wakeup', 'reviewer', 'focus')).toBe('include');
    expect(getDirective('wakeup', 'reviewer', 'situation')).toBe('include');
  });
});
