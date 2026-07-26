export const PROJECT_VIEW_CHANNEL = 'project:view' as const;
export const PROJECT_VIEW_VERSION = 1 as const;

export type ProjectViewEventKind =
  | 'runtime.session'
  | 'runtime.activity'
  | 'runtime.text.delta'
  | 'runtime.thinking.delta'
  | 'runtime.plan'
  | 'runtime.tool.started'
  | 'runtime.tool.completed'
  | 'runtime.tool.failed'
  | 'runtime.warning'
  | 'runtime.usage'
  | 'runtime.completed'
  | 'chat.message.persisted'
  | 'terminal.output'
  | 'terminal.exited';

export interface ProjectViewEventInput {
  kind: ProjectViewEventKind;
  agentId?: string;
  invocationId?: string;
  eventId?: string;
  occurredAt?: string;
  payload: Record<string, unknown>;
}

export interface ProjectViewEnvelope extends ProjectViewEventInput {
  version: typeof PROJECT_VIEW_VERSION;
  projectId: string;
  occurredAt: string;
}

export function isProjectViewEnvelope(value: unknown): value is ProjectViewEnvelope {
  if (!value || typeof value !== 'object') return false;
  const envelope = value as Partial<ProjectViewEnvelope>;
  return envelope.version === PROJECT_VIEW_VERSION
    && typeof envelope.projectId === 'string'
    && envelope.projectId.trim().length > 0
    && typeof envelope.kind === 'string'
    && typeof envelope.occurredAt === 'string'
    && !!envelope.payload
    && typeof envelope.payload === 'object';
}
