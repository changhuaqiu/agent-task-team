export type AgentResponsibility = 'coordinator' | 'implementer' | 'reviewer' | 'specialist';

export function isAgentResponsibility(value: unknown): value is AgentResponsibility {
  return value === 'coordinator' || value === 'implementer' || value === 'reviewer' || value === 'specialist';
}
