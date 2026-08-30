import type { AgentOutcomeType } from './types';

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: Array<string | number>;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
}
const STRING_ARRAY: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
};

const TASK_GRAPH_PAYLOAD_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'Create or assign a revision-fenced project Task Graph. The platform injects expectedRevision.',
  properties: {
    tasks: {
      type: 'array',
      description: 'One or more new Tasks or existing ready/proposed WorkItems to assign.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Stable Task or existing WorkItem id.' },
          title: { type: 'string' },
          agentId: { type: 'string', description: 'Exact Project Agent id that will own this Task.' },
          description: { type: 'string' },
          dependencies: STRING_ARRAY,
          initialStatus: { type: 'string', enum: ['proposed', 'ready'] },
        },
        required: ['id', 'title', 'agentId'],
        additionalProperties: false,
      },
    },
  },
  required: ['tasks'],
  additionalProperties: false,
};

const CONTINUE_PAYLOAD_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'A bounded checkpoint that schedules the next fenced Work epoch.',
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    reason: {
      type: 'string',
      enum: ['multi_step', 'context_boundary', 'verification_follow_up'],
    },
    summary: { type: 'string' },
    nextAction: { type: 'string' },
    completedSteps: STRING_ARRAY,
    remainingSteps: STRING_ARRAY,
  },
  required: [
    'schemaVersion',
    'reason',
    'summary',
    'nextAction',
    'completedSteps',
    'remainingSteps',
  ],
  additionalProperties: false,
};

const HANDOFF_PAYLOAD_SCHEMA: JsonSchema = {
  type: 'object',
  description: 'One bounded cross-role handoff. The platform supplies its internal idempotency identity.',
  properties: {
    branches: {
      type: 'array',
      description: 'One to three independently actionable receivers.',
      items: {
        type: 'object',
        properties: {
          toAgentId: { type: 'string', description: 'Exact target Agent id.' },
          intent: {
            type: 'string',
            enum: ['delegate', 'review', 'answer', 'verify', 'implement', 'plan', 'reject', 'escalate', 'coord'],
          },
          taskId: { type: 'string', description: 'Existing Task id when this handoff executes a planned Task.' },
          title: { type: 'string', description: 'Short user-facing handoff title.' },
          requestedAction: { type: 'string', description: 'Concrete action the receiver must complete.' },
          possessionSummary: { type: 'string' },
          relevantDecisions: STRING_ARRAY,
          evidenceRefs: STRING_ARRAY,
          constraints: STRING_ARRAY,
          openQuestions: STRING_ARRAY,
          forbiddenBehaviors: STRING_ARRAY,
          sourceMessageIds: STRING_ARRAY,
        },
        required: ['toAgentId', 'intent', 'title', 'requestedAction'],
        additionalProperties: false,
      },
    },
    sourcePossessionId: { type: 'string' },
    expectedSourceRevision: { type: 'integer' },
    maxHops: { type: 'integer' },
  },
  required: ['branches'],
  // Older Agents may attach explanatory root metadata. The canonical parser
  // ignores it, so keep that compatibility while branches remain strict.
  additionalProperties: true,
};

export function outcomePayloadSchema(outcomeType: AgentOutcomeType): JsonSchema {
  if (outcomeType === 'handoff_to_agent') return HANDOFF_PAYLOAD_SCHEMA;
  if (outcomeType === 'propose_task_graph') return TASK_GRAPH_PAYLOAD_SCHEMA;
  if (outcomeType === 'continue_work') return CONTINUE_PAYLOAD_SCHEMA;
  return { type: 'object', description: `Structured ${outcomeType} payload.` };
}

/**
 * Adapts the public MCP input to the canonical domain payload. The public tool has
 * one idempotency key; the historical A2A aggregate still stores it inside payload.
 */
export function adaptAcpOutcomePayload(
  outcomeType: AgentOutcomeType,
  payload: unknown,
  idempotencyKey: string,
  authoritativeRevisions: Record<string, string | number> = {},
): unknown {
  if (outcomeType === 'propose_task_graph') {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload ?? {};
    return {
      ...payload as Record<string, unknown>,
      expectedRevision: authoritativeRevisions.taskGraph,
    };
  }
  if (outcomeType !== 'handoff_to_agent') return payload ?? {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload ?? {};
  const record = payload as Record<string, unknown>;
  return {
    ...record,
    idempotencyKey: idempotencyKey.trim(),
  };
}
