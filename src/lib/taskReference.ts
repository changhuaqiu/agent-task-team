const LEGACY_TASK_REFERENCE = /^task-\d{3}$/i;
const TASK_REFERENCE_PATTERN = /#(task-[a-z0-9]+(?:-[a-z0-9]+)*)/i;

export function extractTaskReference(input: string): string | undefined {
  const raw = input.match(TASK_REFERENCE_PATTERN)?.[1];
  if (!raw) return undefined;
  return LEGACY_TASK_REFERENCE.test(raw) ? raw.toUpperCase() : raw.toLowerCase();
}
