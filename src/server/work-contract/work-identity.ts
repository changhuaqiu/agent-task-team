export type StructuredWorkScope = 'task' | 'delivery';
export type StructuredWorkPurpose = 'execute' | 'review' | 'verify' | 'delegate';

export interface StructuredWorkIdentity {
  scope: StructuredWorkScope;
  targetId: string;
  agentId: string;
  purpose: StructuredWorkPurpose;
  gateId?: string;
}

function segment(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes(':')) {
    throw new Error(`invalid_work_identity_${field}`);
  }
  return normalized;
}

export function buildWorkIdentity(input: StructuredWorkIdentity): string {
  const scope = input.scope;
  const targetId = segment(input.targetId, 'target');
  const agentId = segment(input.agentId, 'agent');
  const purpose = segment(input.purpose, 'purpose');
  const gate = input.gateId ? `:gate:${segment(input.gateId, 'gate')}` : '';
  return `${scope}:${targetId}:agent:${agentId}${gate}:purpose:${purpose}`;
}

export function parseWorkIdentity(value: string | undefined): StructuredWorkIdentity | undefined {
  if (!value) return undefined;
  const match = /^(task|delivery):([^:]+):agent:([^:]+)(?::gate:([^:]+))?:purpose:([^:]+)$/.exec(
    value.trim(),
  );
  if (!match) return undefined;
  if (!['execute', 'review', 'verify', 'delegate'].includes(match[5])) return undefined;
  return {
    scope: match[1] as StructuredWorkScope,
    targetId: match[2],
    agentId: match[3],
    ...(match[4] ? { gateId: match[4] } : {}),
    purpose: match[5] as StructuredWorkPurpose,
  };
}

export function hasWorkPurpose(
  value: string | undefined,
  purpose: StructuredWorkPurpose,
): boolean {
  return parseWorkIdentity(value)?.purpose === purpose;
}
