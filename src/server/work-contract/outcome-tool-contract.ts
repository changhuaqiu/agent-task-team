import type { AgentOutcomeType } from './types';

export interface JsonSchema {
  type: string;
  description?: string;
  enum?: string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
}
const STRING_ARRAY: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
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
  additionalProperties: false,
};

export function outcomePayloadSchema(outcomeType: AgentOutcomeType): JsonSchema {
  if (outcomeType === 'handoff_to_agent') return HANDOFF_PAYLOAD_SCHEMA;
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
): unknown {
  if (outcomeType !== 'handoff_to_agent') return payload ?? {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload ?? {};
  const record = payload as Record<string, unknown>;
  return {
    ...record,
    idempotencyKey: typeof record.idempotencyKey === 'string' && record.idempotencyKey.trim()
      ? record.idempotencyKey.trim()
      : idempotencyKey,
  };
}
