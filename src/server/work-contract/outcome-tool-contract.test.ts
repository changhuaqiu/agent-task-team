import { describe, expect, it } from 'vitest';
import { adaptAcpOutcomePayload, outcomePayloadSchema } from './outcome-tool-contract';

describe('ACP outcome tool contract', () => {
  it('publishes the actionable handoff shape instead of an opaque payload object', () => {
    expect(outcomePayloadSchema('handoff_to_agent')).toMatchObject({
      required: ['branches'],
      additionalProperties: true,
      properties: {
        branches: {
          type: 'array',
          items: {
            required: ['toAgentId', 'intent', 'title', 'requestedAction'],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it('uses the public tool idempotency key for the canonical A2A payload', () => {
    expect(adaptAcpOutcomePayload('handoff_to_agent', {
      branches: [{
        toAgentId: 'luigi',
        intent: 'implement',
        title: '实现在线面试',
        requestedAction: '完成任务并提交结果',
      }],
    }, 'handoff-online-interview')).toEqual({
      idempotencyKey: 'handoff-online-interview',
      branches: [{
        toAgentId: 'luigi',
        intent: 'implement',
        title: '实现在线面试',
        requestedAction: '完成任务并提交结果',
      }],
    });
  });

  it('makes the public tool key canonical when a legacy payload repeats it', () => {
    expect(adaptAcpOutcomePayload('handoff_to_agent', {
      idempotencyKey: 'stale-inner-key',
      branches: [],
      summary: 'legacy explanatory metadata',
    }, ' current-tool-key ')).toMatchObject({
      idempotencyKey: 'current-tool-key',
      summary: 'legacy explanatory metadata',
    });
  });

  it('publishes field-level schemas for Task Graph proposals and continuations', () => {
    expect(outcomePayloadSchema('propose_task_graph')).toMatchObject({
      required: ['tasks'],
      additionalProperties: false,
      properties: {
        tasks: {
          items: {
            required: ['id', 'title', 'agentId'],
            additionalProperties: false,
          },
        },
      },
    });
    expect(outcomePayloadSchema('continue_work')).toMatchObject({
      required: [
        'schemaVersion', 'reason', 'summary', 'nextAction', 'completedSteps', 'remainingSteps',
      ],
      additionalProperties: false,
    });
  });

  it('injects the frozen Task Graph revision into the canonical proposal', () => {
    expect(adaptAcpOutcomePayload('propose_task_graph', {
      tasks: [{ id: 'work-1', title: 'Implement', agentId: 'luigi' }],
    }, 'proposal-key', { taskGraph: 7 })).toEqual({
      expectedRevision: 7,
      tasks: [{ id: 'work-1', title: 'Implement', agentId: 'luigi' }],
    });
  });
});
