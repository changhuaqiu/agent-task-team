const NATIVE_RUNTIME_TOOLS = new Set([
  'read', 'write', 'edit', 'bash', 'agent', 'glob', 'grep',
  'todoread', 'todowrite', 'websearch', 'webfetch',
  'notebookedit', 'taskcreate', 'taskupdate', 'tasklist', 'taskget',
  'askuserquestion', 'enterplanmode', 'exitplanmode',
  'croncreate', 'crondelete', 'cronlist',
  'skill', 'schedulewakeup',
]);

export function isNativeRuntimeTool(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return NATIVE_RUNTIME_TOOLS.has(normalized) || normalized.startsWith('mcp__');
}
