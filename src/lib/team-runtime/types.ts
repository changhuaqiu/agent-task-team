import type { AgentTheme } from '@/store/agentStore';
import type { CliEngine } from '@/server/types';
import type { RoleCard } from '@/types/roleCard';
import type { TeamPack } from '@/types/teamPack';
import type { SkillSummary } from '@/lib/agent-context/PromptComposer';

export type RuntimeAgentSource = 'preset-agent' | 'team-pack-role';

export interface RuntimeAgent {
  id: string;
  displayName: string;
  source: RuntimeAgentSource;
  roleCardId?: string;
  roleCard?: RoleCard;
  accountIds: string[];
  skills: SkillSummary[];
  cliEngine?: CliEngine;
  emoji?: string;
  theme?: AgentTheme;
  canModifyCode?: boolean;
  canReview?: boolean;
}

export interface CommunicationPolicy {
  canSend(fromAgentId: string, toAgentId: string): boolean;
  explainBlock(fromAgentId: string, toAgentId: string): string | undefined;
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
    engine: CliEngine;
    accountId?: string;
    runtimeId?: string;
  };
  prompt: {
    roleCard?: RoleCard;
    skills: SkillSummary[];
    teamPack?: TeamPack;
    roster: RuntimeAgent[];
  };
}
