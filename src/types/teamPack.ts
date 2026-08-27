import type { RoleCard } from './roleCard';

export type WorkflowType = 'linear' | 'state_machine';

export type RoleCardSnapshot = Omit<RoleCard, 'id' | 'isPreset' | 'version' | 'createdAt' | 'updatedAt'> & {
  sourceRoleCardId?: string;
  snapshotVersion: number;
  snapshottedAt: string;
};

export interface WorkflowTransition {
  from: string;
  to: string;
  condition: string;
  trigger?: string;
}

export interface LinearWorkflowStep {
  role: string;
  action: string;
  output: string;
  canReject?: boolean;
}

export interface StateMachineState {
  name: string;
  role: string;
  description: string;
  transitions: WorkflowTransition[];
  terminal?: boolean;
}

export interface TeamPackWorkflow {
  type: WorkflowType;
  description?: string;
  steps?: LinearWorkflowStep[];
  states?: StateMachineState[];
}

export interface TeamPackRole {
  id: string;
  displayName: string;
  required: boolean;
}

/** Exact historical storage/seed role. It is never a current API projection. */
export interface LegacyTeamPackRole extends TeamPackRole {
  soul: string;
  description?: string;
  roleCardId?: string;
  roleCardSnapshot?: RoleCardSnapshot;
  accountIds?: string[];
  skillIds?: string[];
}

export interface TeamPackCommunicationMatrix {
  [roleId: string]: {
    canSendTo: string[];
    canReceiveFrom: string[];
    canEscalateTo?: string[];
  };
}

export interface TeamPackSharedContext {
  files?: string[];
  state?: string[];
  memory?: string[];
}

export interface TeamPackRules {
  maxIterations?: number;
  escalationTimeoutHours?: number;
  requireEvidence?: boolean;
  autoAssign?: boolean;
}

export interface TeamPack {
  id: string;
  specVersion: 'team-pack/0.1';
  name: string;
  displayName: string;
  description: string;
  version: string;
  author?: {
    name: string;
    github?: string;
  };
  license?: string;
  tags: string[];
  category: string;
  roles: TeamPackRole[];
  teamMode: 'pipeline' | 'parallel' | 'hub_spoke' | 'custom';
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
  source?: {
    type: 'github' | 'preset';
    url?: string;
    importedAt: string;
  };
  isPreset: boolean;
  createdAt: string;
  updatedAt: string;
  /** Revision of the current Agent Team aggregate. */
  revision?: number;
}

/** Current write model: a Team references Agents; it never owns capability data. */
export interface AgentTeamDefinitionInput {
  name: string;
  displayName: string;
  description: string;
  version?: string;
  tags?: string[];
  category?: string;
  members: Array<{ agentId: string; required?: boolean }>;
  teamMode: 'pipeline' | 'parallel' | 'hub_spoke' | 'custom';
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
}

/** Migration/managed-seed shape for historical rows. Never expose as a product write DTO. */
export interface LegacyTeamPackSeedInput {
  name: string;
  displayName: string;
  description: string;
  version?: string;
  author?: { name: string; github?: string };
  license?: string;
  tags?: string[];
  category?: string;
  roles: LegacyTeamPackRole[];
  teamMode: 'pipeline' | 'parallel' | 'hub_spoke' | 'custom';
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
  source?: {
    type: 'github' | 'preset';
    url?: string;
    importedAt: string;
  };
  isPreset?: boolean;
}
