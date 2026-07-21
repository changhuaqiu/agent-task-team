export function buildOpenCodeRunArgs(input: {
  prompt: string;
  sessionId?: string;
}): string[] {
  const args = ['run', '--format', 'json'];
  if (input.sessionId) args.push('--session', input.sessionId);
  // System context is intentionally absent. OpenCode receives it through the
  // generated OPENCODE_CONFIG instructions file exactly once.
  args.push(input.prompt);
  return args;
}
