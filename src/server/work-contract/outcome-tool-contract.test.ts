import { describe, expect, it } from 'vitest';
import { adaptAcpOutcomePayload, outcomePayloadSchema } from './outcome-tool-contract';

describe('ACP outcome tool contract', () => {
  it('publishes the actionable handoff shape instead of an opaque payload object', () => {
    expect(outcomePayloadSchema('handoff_to_agent')).toMatchObject({
      required: ['branches'],
      properties: {
        branches: {
          type: 'array',
          items: {
            required: ['toAgentId', 'intent', 'title', 'requestedAction'],
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
});
