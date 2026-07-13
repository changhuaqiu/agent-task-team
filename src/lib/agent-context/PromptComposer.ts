import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import { AGENT_ROSTER } from '@/store/agentStore';
import type { RuntimeAgent } from '@/lib/team-runtime';
import { buildRoleLayer } from './layers/roleLayer';
import { buildProjectLayer } from './layers/projectLayer';
import { buildTeamLayer } from './layers/teamLayer';
import { buildProjectStatusLayer } from './layers/projectStatusLayer';
import { buildHistoryLayer } from './layers/historyLayer';
import { buildTaskContextLayer } from './layers/taskContextLayer';
import { buildUserMessageLayer } from './layers/userMessageLayer';
import { buildBehaviorLayer } from './layers/behaviorLayer';
import { buildSkillLayer } from './layers/skillLayer';
import { buildToolLayer } from './layers/toolLayer';
import { buildProtocolLayer, deriveRoleFromCard } from './layers/protocolLayer';
import { buildA2ALayer } from './layers/a2aLayer';
import { buildTeamPackLayer } from './layers/teamPackLayer';
import { buildCollaborationLayer } from './layers/collaborationLayer';
import type { TeamPack } from '@/types/teamPack';
import { ContextBudget } from './ContextBudget';
import { composeWithBudget, type BudgetPart } from './BudgetGuard';
import type { ContextRequest } from './ContextManager';
import { ContextManager } from './ContextManager';
import { noOpMemoryHook } from './MemoryHook';

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
  name: string;
  content: string;
  files?: { path: string; content: string }[];
  config?: string;
}

export function extractToolsFromSkills(skills: SkillSummary[]): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const skill of skills) {
    if (!skill.config) continue;
    try {
      const parsed = JSON.parse(skill.config);
      if (Array.isArray(parsed.tools)) {
        tools.push(...parsed.tools);
      }
    } catch {
      // invalid config JSON — skip
    }
  }
  return tools;
}

export interface ComposeOptions {
  agent: { id: string; name: string };
  roleCard?: RoleCard;
  allRoleCards: RoleCard[];
  project: { id: string; name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
  currentLoad?: Record<string, number>;
  tasks?: { id: string; title: string; agentId: string; status: 'pending' | 'in_progress' | 'done' }[];
  skills?: SkillSummary[];
  a2a?: { from?: string; content?: string; contextSnapshot?: string };
  teamPack?: TeamPack;
  runtimeRoster?: RuntimeAgent[];
  /** 上下文 token 预算（默认 new ContextBudget()） */
  budget?: ContextBudget;
}

export async function composeSystemPrompt(opts: ComposeOptions): Promise<string | undefined> {
  const manager = new ContextManager({
    getRoleCard: async () => opts.roleCard,
    getAllRoleCards: async () => opts.allRoleCards ?? [],
    getMessages: async () => opts.messages ?? [],
    getTask: async () => opts.task,
    getTasks: async () => opts.tasks ?? [],
    getTeamPack: async () => opts.teamPack,
    getRuntimeRoster: async () => opts.runtimeRoster ?? [],
    getSkills: async () => [],
    getCurrentLoad: () => opts.currentLoad ?? {},
  }, noOpMemoryHook);

  const req: ContextRequest = {
    agentId: opts.agent.id,
    conversationId: opts.project.name, // P1 临时用 name 作为 conversationId，待后续改造
    rawPrompt: opts.rawPrompt,
    trigger: 'user_turn',
    isFirstWake: opts.isFirstWake,
    budgetOverride: opts.budget,
  };

  const result = await manager.assembleContext(req);
  return result.systemPrompt;
}

export async function composeUserPrompt(opts: ComposeOptions): Promise<string> {
  const manager = new ContextManager({
    getRoleCard: async () => opts.roleCard,
    getAllRoleCards: async () => opts.allRoleCards ?? [],
    getMessages: async () => opts.messages ?? [],
    getTask: async () => opts.task,
    getTasks: async () => opts.tasks ?? [],
    getTeamPack: async () => opts.teamPack,
    getRuntimeRoster: async () => opts.runtimeRoster ?? [],
    getSkills: async () => [],
    getCurrentLoad: () => opts.currentLoad ?? {},
  }, noOpMemoryHook);

  const req: ContextRequest = {
    agentId: opts.agent.id,
    conversationId: opts.project.name, // P1 临时用 name 作为 conversationId，待后续改造
    taskId: opts.task?.id,
    rawPrompt: opts.rawPrompt,
    trigger: opts.a2a?.from && opts.a2a?.content ? 'a2a_handoff' : 'user_turn',
    a2aHandoff: opts.a2a ? {
      title: opts.a2a.content ?? '',
      requestedAction: '',
      possessionSummary: opts.a2a.content ?? '',
      relevantDecisions: [],
      evidenceRefs: [],
      constraints: [],
      openQuestions: [],
      forbiddenBehaviors: [],
      sourceMessageIds: [],
    } : undefined,
    isFirstWake: opts.isFirstWake,
    budgetOverride: opts.budget,
  };

  const result = await manager.assembleContext(req);

  // 如果是首次唤醒，返回 systemPrompt + userPrompt
  if (opts.isFirstWake && result.systemPrompt) {
    return result.systemPrompt + '\n\n' + result.userPrompt;
  }

  return result.userPrompt;
}
