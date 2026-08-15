export const TASK_STATUSES = [
  'proposed',
  'ready',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

const TASK_STATUS_SET = new Set<string>(TASK_STATUSES);

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  proposed: ['ready', 'cancelled'],
  ready: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'in_review', 'cancelled'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  in_review: ['done', 'in_progress', 'blocked', 'cancelled'],
  done: ['ready'],
  cancelled: [],
};

const DIRECT_TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  proposed: ['ready', 'cancelled'],
  ready: ['in_progress', 'blocked', 'cancelled'],
  in_progress: ['blocked', 'cancelled'],
  blocked: ['ready', 'in_progress', 'cancelled'],
  in_review: ['in_progress', 'blocked', 'cancelled'],
  done: ['ready'],
  cancelled: [],
};

export class InvalidTaskStatusError extends Error {
  readonly reasonCode = 'invalid_task_status';

  constructor(readonly status: string) {
    super(`Unsupported task status: ${status}`);
  }
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && TASK_STATUS_SET.has(value);
}

export function assertTaskStatus(value: string): TaskStatus {
  if (!isTaskStatus(value)) throw new InvalidTaskStatusError(value);
  return value;
}

/** Evidence-free transitions that a direct browser action may submit. */
export function nextDirectTaskStatuses(from: TaskStatus): readonly TaskStatus[] {
  return DIRECT_TASK_TRANSITIONS[from];
}

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TASK_TRANSITIONS[from].includes(to);
}
