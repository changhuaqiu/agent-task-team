import type { CapabilityProfile } from './capabilityProfile';

// --- RoleCard Type System ---
// 9 dimensions: Identity, Responsibility, Work Style, Action Boundaries,
// Capability Binding, Output & Quality, Persona, Capability Profile, Engineering

export type RoleCardCategory =
  | 'planner'
  | 'frontend'
  | 'backend'
  | 'code_reviewer'
  | 'arch_reviewer'
  | 'qa';

export type OutputStyle = 'concise' | 'detailed' | 'structured';

export type ClarifyPolicy = 'always' | 'when_ambiguous' | 'never';

export type ActionPermission =
  | 'can_modify_code'
  | 'can_create_files'
  | 'can_modify_config'
  | 'can_propose_only'
  | 'requires_confirmation_for_critical';

export type OutputFormat = 'freeform' | 'structured_list' | 'report' | 'checklist';

export type RiskGrading = 'none' | 'required' | 'optional';

export type WorkflowStepStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  output: string;
  reviewGate: boolean;
  estimatedDuration?: string;
}

export interface EscalationRule {
  when: string;
  action: string;
  target: 'human' | string;
}

export interface CommunicationMatrix {
  canSendTo: string[];
  canReceiveFrom: string[];
  canEscalateTo: string[];
}

export interface EngineeringConfig {
  roleType: 'planner' | 'implementer' | 'reviewer' | 'coordinator' | 'specialist';
  canModifyCode: boolean;
  canApprovePR: boolean;
  mustReportTo: string[];
  escalationRules: EscalationRule[];
  reviewRequired: boolean;
  outputEvidence: boolean;
  workflow?: WorkflowStep[];
  communication?: CommunicationMatrix;
}

export interface RoleCard {
  id: string;

  // Dimension 1: Identity
  name: string;
  displayName: string;
  description: string;
  category: RoleCardCategory;
  tags: string[];
  applicableScenarios: string[];

  // Dimension 2: Responsibility
  responsibilities: string[];
  nonResponsibilities: string[];
  successCriteria: string[];

  // Dimension 3: Work Style
  clarifyBeforeExecute: ClarifyPolicy;
  outputStyle: OutputStyle;
  preferStructuredOutput: boolean;

  // Dimension 4: Action Boundaries
  allowedActions: ActionPermission[];
  requiresConfirmation: string[];
  forbiddenActions: string[];

  // Dimension 5: Capability Binding
  preferredEngines: string[];
  allowedTools: string[];
  accountIds: string[];

  // Dimension 6: Output & Quality
  outputFormat: OutputFormat;
  requiresEvidence: boolean;
  riskGrading: RiskGrading;

  // Dimension 8: Capability Profile
  capabilities?: CapabilityProfile;

  // Dimension 9: Engineering (optional, for team collaboration)
  engineering?: EngineeringConfig;

  // Dimension 7: Persona
  persona?: {
    introduction: string;
    voice: string;
    mindset: string;
    habits: string;
    collaboration: string;
  };

  // Meta
  isPreset: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
