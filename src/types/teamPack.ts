export type WorkflowType = 'linear' | 'state_machine';

export interface Task {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

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
  soul: string;
  required: boolean;
  description?: string;
  roleCardId?: string;
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
}

export interface CreateTeamPackInput {
  name: string;
  displayName: string;
  description: string;
  version?: string;
  author?: { name: string; github?: string };
  license?: string;
  tags?: string[];
  category?: string;
  roles: TeamPackRole[];
  teamMode: 'pipeline' | 'parallel' | 'hub_spoke' | 'custom';
  workflow: TeamPackWorkflow;
  communicationMatrix: TeamPackCommunicationMatrix;
  sharedContext?: TeamPackSharedContext;
  rules?: TeamPackRules;
}
