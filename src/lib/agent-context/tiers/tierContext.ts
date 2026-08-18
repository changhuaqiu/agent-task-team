import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import type { RuntimeAgent } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import type { ContextCluster, ContextArchetype } from '../injectionPolicy';
import type { ContextScenario } from '../scenarioResolver';
import type { ContextRequest } from '../ContextManager';
import type { TeamLogEnvelope } from '../teamLog';
import type { SkillSummary, ToolDefinition } from '../types';

/** Provider data already fetched by assembleContext and exposed read-only. */
export interface TierContext {
  req: ContextRequest;
  scenario: ContextScenario;
  archetype: ContextArchetype;
  /** Whether this dispatch sends identity/protocol through the system channel. */
  bootstrapIdentity: boolean;
  agentId: string;
  conversationId: string;
  roleCard: RoleCard | undefined;
  messages: ChatMessage[];
  task: {
    id: string;
    title: string;
    conversationId: string;
    description?: string;
    phase?: { title: string };
  } | undefined;
  tasks: { id: string; title: string; agentId: string; status: string }[];
  teamPack: TeamPack | undefined;
  runtimeRoster: RuntimeAgent[];
  skillSummaries: SkillSummary[];
  tools: ToolDefinition[];
  teamLogEnvelope: TeamLogEnvelope | undefined;
}

export interface TierPush {
  (
    cluster: ContextCluster,
    layer: string,
    content: string | null | undefined,
    opts: {
      private?: boolean;
      source?: string;
      evidenceRefs?: string[];
    },
  ): void;
}

export interface TierRenderInput {
  ctx: TierContext;
  /** Collect candidates; ContextManager applies scenario policy centrally. */
  push: TierPush;
}
