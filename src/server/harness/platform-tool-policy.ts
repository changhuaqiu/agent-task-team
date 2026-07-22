import { TASK_MANAGEMENT_SKILL } from '@/data/presetSkills/taskManagement';
import { extractToolsFromSkills } from '@/lib/agent-context/skillTools';
import type { ToolDefinition } from '@/lib/agent-context/types';
import type { RoleCard } from '@/types/roleCard';

const TASK_CONTROL_TOOL_NAMES = new Set([
  'task_list',
  'task_update_status',
]);

const TASK_COORDINATION_TOOL_NAMES = new Set([
  ...TASK_CONTROL_TOOL_NAMES,
  'task_create',
  'task_assign',
]);

const TASK_MANAGEMENT_TOOLS = extractToolsFromSkills([{
  name: TASK_MANAGEMENT_SKILL.name,
  description: TASK_MANAGEMENT_SKILL.description ?? undefined,
  content: TASK_MANAGEMENT_SKILL.content,
  config: TASK_MANAGEMENT_SKILL.config ?? undefined,
}]);

export function resolvePlatformTaskTools(input: {
  hasTask: boolean;
  roleCategory?: RoleCard['category'];
  evaluation?: boolean;
}): ToolDefinition[] {
  if (input.evaluation) return [];
  const permittedNames = input.roleCategory === 'planner'
    ? TASK_COORDINATION_TOOL_NAMES
    : input.hasTask
      ? TASK_CONTROL_TOOL_NAMES
      : new Set<string>();
  return TASK_MANAGEMENT_TOOLS.filter((tool) => permittedNames.has(tool.name));
}
