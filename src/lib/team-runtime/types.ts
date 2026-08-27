import type { TeamPack } from '@/types/teamPack';
import type { RuntimeCliEngine } from './runtimeEngine';
import type { AgentResponsibility } from '@/shared/agent-definition';

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
  accountIds: string[];
  skills: RuntimeSkillSummary[];
  cliEngine?: RuntimeCliEngine;
  instructions?: string;
  responsibility?: AgentResponsibility;
  model?: string;
  emoji?: string;
  theme?: RuntimeAgentTheme;
  canModifyCode?: boolean;
  canReview?: boolean;
}

export interface TeamRuntime {
  conversationId: string;
  teamPack?: TeamPack;
  roster: RuntimeAgent[];
  explainHandoffBlock(fromAgentId: string, toAgentId: string): string | undefined;
  initialAgentId: string | null;
}

export interface RuntimeAgentProfile {
  agent: RuntimeAgent;
  execution: {
    engine: RuntimeCliEngine;
    accountId?: string;
    runtimeId?: string;
    preferredModel?: string;
  };
  prompt: {
    skills: RuntimeSkillSummary[];
    teamPack?: TeamPack;
    roster: RuntimeAgent[];
  };
}
