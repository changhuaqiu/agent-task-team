import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';
import type { RuntimeCliEngine } from './runtimeEngine';

export type { RuntimeCliEngine } from './runtimeEngine';

export type RuntimeAgentSource = 'preset-agent' | 'team-pack-role';
export type RuntimeAgentTheme = 'mario' | 'luigi' | 'peach' | 'dk';
export interface RuntimeSkillSummary {
  id?: string;
  name: string;
  description?: string;
  version?: number;
  content?: string;
  files?: { path: string; content: string }[];
  config?: string;
}

export interface RuntimeAgent {
  id: string;
  displayName: string;
  source: RuntimeAgentSource;
  roleCardId?: string;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: RuntimeSkillSummary[];
  cliEngine?: RuntimeCliEngine;
  emoji?: string;
  theme?: RuntimeAgentTheme;
  canModifyCode?: boolean;
  canReview?: boolean;
}

export interface CommunicationPolicy {
  canSend(fromAgentId: string, toAgentId: string): boolean;
  explainBlock(fromAgentId: string, toAgentId: string): string | undefined;
  getEscalationTarget?(fromAgentId: string, blockedToAgentId?: string): string | undefined;
}

export interface TaskAssignment {
  taskId: string;
  agentId: string;
  roleId: string;
  assignedAt: string;
}

export interface WorkflowPolicy {
  assignInitialTask(task: { id: string; description?: string; status?: string }): TaskAssignment | null;
  getNextAgent(currentAgentId: string, taskResult: unknown): string | null;
}

export interface TeamRuntime {
  conversationId: string;
  teamPack?: TeamPack;
  roster: RuntimeAgent[];
  communicationPolicy: CommunicationPolicy;
  workflowPolicy: WorkflowPolicy;
}

export interface RuntimeAgentProfile {
  agent: RuntimeAgent;
  execution: {
    engine: RuntimeCliEngine;
    accountId?: string;
    runtimeId?: string;
  };
  prompt: {
    roleCard?: RoleCard;
    skills: RuntimeSkillSummary[];
    teamPack?: TeamPack;
    roster: RuntimeAgent[];
  };
}
