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
  project: { name: string; path: string };
  isFirstWake: boolean;
  messages?: ChatMessage[];
  task?: { id: string; title: string; description?: string; phase?: { title: string } };
  rawPrompt: string;
  currentLoad?: Record<string, number>;
  tasks?: { id: string; title: string; agentId: string; status: string }[];
  skills?: SkillSummary[];
  a2a?: { from?: string; content?: string; contextSnapshot?: string };
  teamPack?: TeamPack;
  runtimeRoster?: RuntimeAgent[];
  /** 上下文 token 预算（默认 new ContextBudget()） */
  budget?: ContextBudget;
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;

  const rosterForStatus = opts.runtimeRoster !== undefined
    ? opts.runtimeRoster.map((a) => ({ id: a.id, name: a.displayName, emoji: a.emoji ?? '🤖' }))
    : AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji }));

  const projectStatus = opts.tasks
    ? buildProjectStatusLayer(
        rosterForStatus,
        opts.tasks as Parameters<typeof buildProjectStatusLayer>[1],
      )
    : '';

  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildProjectLayer(opts.project),
    buildCollaborationLayer(),
    projectStatus,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: BudgetPart[] = [];
  const budget = opts.budget ?? new ContextBudget();
  const a2aDispatch = opts.a2a?.from && opts.a2a?.content
    ? opts.a2a
    : undefined;

  const push = (layer: string, content: string | null | undefined, priority: number) => {
    if (content) parts.push({ layer, content, priority });
  };

  // Skills + tools (P3 — 能力，可按需 JIT)
  const tools = extractToolsFromSkills(opts.skills ?? []);
  push('skill', buildSkillLayer(opts.skills ?? []), 3);
  push('tool', buildToolLayer(tools), 3);

  // Team roster (P2)
  const runtimeTeam = opts.runtimeRoster?.length
    ? [
        '## 当前团队',
        ...opts.runtimeRoster.map((member) => {
          const marker = member.id === opts.agent.id ? '（当前角色）' : '';
          return `- ${member.displayName} @${member.id}${marker}`;
        }),
      ].join('\n')
    : '';
  const team = opts.runtimeRoster !== undefined
    ? runtimeTeam
    : buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad);
  push('team', team, 2);

  push('collaboration', buildCollaborationLayer(), 1);

  // TeamPack context (P1)
  if (opts.teamPack) {
    push('teamPack', buildTeamPackLayer(opts.agent.id, opts.teamPack), 1);
  }

  // Protocol layer (P0 — 约束，几乎不丢)
  push('protocol', buildProtocolLayer({
    agentId: opts.agent.id,
    agentRole: deriveRoleFromCard(opts.roleCard),
    projectPath: opts.project.path,
    hasTaskAssignment: !!opts.task,
    isPlanner: opts.roleCard?.category === 'planner',
  }), 0);

  // History (P4 — GSSC：按 query 相关性筛选)
  push('history', buildHistoryLayer(opts.messages ?? [], opts.agent.id, {
    query: opts.rawPrompt,
    limit: 10,
  }), 4);

  // Task context (P0)
  if (opts.task) {
    push('task', buildTaskContextLayer(opts.task), 0);
  }

  // A2A context (P1) or user message (P0)
  if (a2aDispatch) {
    push('a2a', buildA2ALayer({
      a2aFrom: a2aDispatch.from,
      a2aContent: a2aDispatch.content,
      a2aContextSnapshot: a2aDispatch.contextSnapshot,
    }), 1);
  } else {
    push('userMessage', buildUserMessageLayer(opts.rawPrompt), 0);
  }

  // Behavior (P0 — 闭环动作要求)
  push('behavior', buildBehaviorLayer(), 0);

  const { prompt } = composeWithBudget(parts, budget);
  return prompt;
}
