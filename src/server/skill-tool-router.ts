// Platform Tool allowlist shared by Context planning, daemon grants, and execution.

const SUPPORTED_TOOL_NAMES = new Set([
  'task_list',
  'task_create',
  'task_update_status',
  'task_assign',
  'verification_serve_artifact',
  'collaboration_record_pr',
  'collaboration_record_review',
  'collaboration_record_merge',
]);

export function isSkillTool(toolName: string): boolean {
  return SUPPORTED_TOOL_NAMES.has(toolName);
}

export function getSupportedToolNames(): string[] {
  return [...SUPPORTED_TOOL_NAMES];
}
