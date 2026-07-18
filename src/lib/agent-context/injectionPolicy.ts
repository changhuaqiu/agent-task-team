import type { RoleCard } from '@/types/roleCard';
import type { ContextScenario } from './scenarioResolver';

export type ContextArchetype = 'planner' | 'reviewer' | 'worker';
export type ContextCluster = 'identity' | 'protocol' | 'capability' | 'situation' | 'focus' | 'dialog';
export type InjectionDirective = 'include' | 'omit';

const include = (...clusters: ContextCluster[]): Record<ContextCluster, InjectionDirective> => {
  const selected = new Set(clusters);
  return {
    identity: selected.has('identity') ? 'include' : 'omit',
    protocol: selected.has('protocol') ? 'include' : 'omit',
    capability: selected.has('capability') ? 'include' : 'omit',
    situation: selected.has('situation') ? 'include' : 'omit',
    focus: selected.has('focus') ? 'include' : 'omit',
    dialog: selected.has('dialog') ? 'include' : 'omit',
  };
};

const initPlanner = include('identity', 'protocol', 'capability', 'situation', 'focus', 'dialog');
const initContributor = include('identity', 'protocol', 'capability', 'situation', 'focus', 'dialog');
const iteratePlanner = include('protocol', 'capability', 'situation', 'focus', 'dialog');
const iterateContributor = include('protocol', 'capability', 'situation', 'focus', 'dialog');
const handoff = include('protocol', 'capability', 'situation', 'focus');
const wakeup = include('protocol', 'capability', 'situation', 'focus');
const closure = include('protocol', 'capability', 'situation', 'focus', 'dialog');

export const INJECTION_POLICY: Record<ContextScenario, Record<ContextArchetype, Record<ContextCluster, InjectionDirective>>> = {
  init: { planner: initPlanner, reviewer: initContributor, worker: initContributor },
  iterate: { planner: iteratePlanner, reviewer: iterateContributor, worker: iterateContributor },
  handoff: { planner: handoff, reviewer: handoff, worker: handoff },
  wakeup: { planner: wakeup, reviewer: wakeup, worker: wakeup },
  closure: { planner: closure, reviewer: closure, worker: closure },
};

export function resolveArchetype(roleCard?: RoleCard): ContextArchetype {
  if (roleCard?.category === 'planner') return 'planner';
  if (roleCard?.category === 'code_reviewer' || roleCard?.category === 'arch_reviewer') return 'reviewer';
  return 'worker';
}

export function getDirective(
  scenario: ContextScenario,
  archetype: ContextArchetype,
  cluster: ContextCluster,
): InjectionDirective {
  return INJECTION_POLICY[scenario][archetype][cluster];
}
