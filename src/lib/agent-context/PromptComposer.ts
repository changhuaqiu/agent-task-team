import type { RoleCard } from '@/types/roleCard';
import type { ChatMessage } from '@/store/taskHubStore';
import { AGENT_ROSTER } from '@/store/taskHubStore';
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
}

export function composeSystemPrompt(opts: ComposeOptions): string | undefined {
  if (!opts.isFirstWake) return undefined;

  const projectStatus = opts.tasks
    ? buildProjectStatusLayer(
        AGENT_ROSTER.map((a) => ({ id: a.id, name: a.name, emoji: a.emoji })),
        opts.tasks as Parameters<typeof buildProjectStatusLayer>[1],
      )
    : '';

  const tools = extractToolsFromSkills(opts.skills ?? []);

  return [
    buildRoleLayer(opts.agent, opts.roleCard),
    buildSkillLayer(opts.skills ?? []),
    buildToolLayer(tools),
    buildProjectLayer(opts.project),
    buildTeamLayer(opts.agent.id, opts.allRoleCards, opts.currentLoad),
    projectStatus,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function composeUserPrompt(opts: ComposeOptions): string {
  const parts: string[] = [];
  if (opts.isFirstWake) {
    const history = buildHistoryLayer(opts.messages ?? [], opts.agent.id);
    if (history) parts.push(history);
  }
  if (opts.task) {
    parts.push(buildTaskContextLayer(opts.task));
  }
  parts.push(buildUserMessageLayer(opts.rawPrompt));
  parts.push(buildBehaviorLayer());
  return parts.join('\n\n---\n\n');
}
