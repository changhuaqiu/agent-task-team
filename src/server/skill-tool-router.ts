// Skill Tool Router — maps api:// handler URLs to internal mutation routes.
// PHASE: hardcoded tool set; will be replaced by skill config reading later.

export interface HandlerMapping {
  method: 'GET' | 'POST';
  mutationType?: string;
  toolName: string;
}

const HANDLER_MAP: Record<string, HandlerMapping> = {
  'api://tasks/list':   { method: 'GET',  mutationType: 'task.list',         toolName: 'task_list' },
  'api://tasks/create': { method: 'POST', mutationType: 'task.create',       toolName: 'task_create' },
  'api://tasks/update': { method: 'POST', mutationType: 'task.updateStatus', toolName: 'task_update_status' },
  'api://tasks/assign': { method: 'POST', mutationType: 'task.update',       toolName: 'task_assign' },
  'api://collaboration/pull-request': { method: 'POST', toolName: 'collaboration_record_pr' },
  'api://collaboration/review': { method: 'POST', toolName: 'collaboration_record_review' },
  'api://collaboration/merge': { method: 'POST', toolName: 'collaboration_record_merge' },
};

const TOOL_NAME_MAP: Record<string, string> = {
  task_list: 'api://tasks/list',
  task_create: 'api://tasks/create',
  task_update_status: 'api://tasks/update',
  task_assign: 'api://tasks/assign',
  collaboration_record_pr: 'api://collaboration/pull-request',
  collaboration_record_review: 'api://collaboration/review',
  collaboration_record_merge: 'api://collaboration/merge',
};

export function resolveHandler(handlerUrl: string): HandlerMapping | null {
  return HANDLER_MAP[handlerUrl] ?? null;
}

export function resolveHandlerByToolName(toolName: string): string | null {
  return TOOL_NAME_MAP[toolName] ?? null;
}

export function isSkillTool(toolName: string): boolean {
  return toolName in TOOL_NAME_MAP;
}

export function getSupportedToolNames(): string[] {
  return Object.keys(TOOL_NAME_MAP);
}
