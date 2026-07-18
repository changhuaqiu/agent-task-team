// src/lib/agent-context/tiers/tierContext.ts
//
// Shared input for the four tier renderers. Each tier is a pure function
// (ctx) => BudgetPart[] that owns its own layer push logic, so adding a
// layer touches one tier file instead of four places across the module.
//
// Design note: tiers are a CODE-ORGANISATION grouping (system/knowledge/
// task/interaction). They do NOT change BudgetPart.tier values — those
// remain 'system' | 'tool' | 'project' so BudgetGuard's trim order and
// ContextReport.layers stay stable (public contract unchanged).

import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import type { RuntimeAgent } from '@/lib/team-runtime';
import type { TeamPack } from '@/types/teamPack';
import type { ContextCluster, ContextArchetype } from '../injectionPolicy';
import type { ContextScenario } from '../scenarioResolver';
import type { ContextRequest } from '../ContextManager';
import type { BudgetPart, ContextTier } from '../BudgetGuard';
import type { A2AHandoffPacket } from '../ContextManager';
import type { TeamLogEnvelope } from '../teamLog';
import type { SkillSummary, ToolDefinition } from '../types';

/** Provider data already fetched by assembleContext — passed in read-only. */
export interface TierContext {
  req: ContextRequest;
  scenario: ContextScenario;
  archetype: ContextArchetype;
  agentId: string;
  conversationId: string;
  roleCard: RoleCard | undefined;
  allRoleCards: RoleCard[];
  messages: ChatMessage[];
  task: { id: string; title: string; description?: string; phase?: { title: string } } | undefined;
  tasks: { id: string; title: string; agentId: string; status: string }[];
  teamPack: TeamPack | undefined;
  runtimeRoster: RuntimeAgent[] | undefined;
  skillSummaries: SkillSummary[];
  tools: ToolDefinition[];
  teamLogEnvelope: TeamLogEnvelope | undefined;
}

/** A push helper bound to the current scenario/archetype, identical in
 *  semantics to the inline closure that lived in assembleContext. */
export interface TierPush {
  (cluster: ContextCluster, layer: string, content: string | null | undefined, opts: {
    tier: ContextTier;
    importance: number;
    scope?: string;
    private?: boolean;
    source?: string;
  }): void;
}

/** Included-cluster check, same as assembleContext's inline getDirective gate. */
export interface TierDirective {
  (cluster: ContextCluster): boolean;
}

export interface TierRenderInput {
  ctx: TierContext;
  /** push into the tier's own parts list, gated by the scenario directive. */
  push: TierPush;
  /** true when the cluster is included for this scenario × archetype. */
  isIncluded: TierDirective;
}
