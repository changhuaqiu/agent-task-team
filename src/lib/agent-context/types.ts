// src/lib/agent-context/types.ts
//
// Neutral home for shared agent-context types. These describe capability
// payloads (skills/tools) used by layers and the context composer — they
// carry no behaviour.

export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  description: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ParamDef[];
  handler: string;
}

export interface SkillSummary {
  id?: string;
  name: string;
  description?: string;
  content: string;
  revision?: string;
  contentHash?: string;
  resourceRefs?: string[];
  activationReason?: 'agent_binding' | 'explicit' | 'task' | 'handoff' | 'rule' | 'semantic';
  required?: boolean;
  config?: string;
}
