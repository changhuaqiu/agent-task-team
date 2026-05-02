// --- RoleCard Type System ---
// 6 dimensions: Identity, Responsibility, Work Style, Action Boundaries,
// Capability Binding, Output & Quality

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

  // Meta
  isPreset: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
