import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/types';
import { AGENT_ROSTER } from '@/store/agentStore';
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
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;

  const projectStatus = opts.tasks
    ? buildProjectStatusLayer(
        AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji })),
        opts.tasks as Parameters<typeof buildProjectStatusLayer>[1],
      )
    : '';

  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildProjectLayer(opts.project),
    projectStatus,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];

  // Skills + tools (every dispatch — CLI is a new process)
  const tools = extractToolsFromSkills(opts.skills ?? []);
  const skillLayer = buildSkillLayer(opts.skills ?? []);
  const toolLayer = buildToolLayer(tools);
  if (skillLayer) parts.push(skillLayer);
  if (toolLayer) parts.push(toolLayer);

  // Team roster (every dispatch — members change over time)
  const team = buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad);
  if (team) parts.push(team);

  // Protocol layer (every dispatch — constraints + guidance)
  const protocol = buildProtocolLayer({
    agentId: opts.agent.id,
    agentRole: deriveRoleFromCard(opts.roleCard),
    projectPath: opts.project.path,
    hasTaskAssignment: !!opts.task,
    isPlanner: opts.roleCard?.category === 'planner',
  });
  if (protocol) parts.push(protocol);

  // History (every dispatch — future: add compression)
  const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
  if (history) parts.push(history);

  // Task context + user message + behavior
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts.task));
  }

  // A2A context (only when dispatched via @mention)
  if (opts.a2a?.from && opts.a2a?.content) {
    parts.push(buildA2ALayer({
      a2aFrom: opts.a2a.from,
      a2aContent: opts.a2a.content,
      a2aContextSnapshot: opts.a2a.contextSnapshot,
    }));
  }

  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());

  return parts.join('\n\n---\n\n');
}
