import { describe, expect, it } from 'vitest';
import { evaluateDeterministically } from './deterministic-evaluator';
import type { SubjectSnapshot } from './types';

function subject(evidence: Record<string, unknown>): SubjectSnapshot {
  return {
    id: 'snapshot-test', conversationId: 'conversation-test', mode: 'offline',
    evidenceCutoffAt: '2026-07-19T00:00:00.000Z', collectedAt: '2026-07-19T00:00:00.000Z',
    snapshotHash: 'hash', evidenceRefs: [], evidence, appManifest: {},
    dataQuality: { coverage: 1, missing: [], truncated: [] },
    taskType: 'coding', difficulty: 'medium', language: 'zh',
  };
}

describe('evaluateDeterministically', () => {
  it('reports 4/5 tool execution success and does not call it tool accuracy', () => {
    const scores = evaluateDeterministically(subject({
      spans: Array.from({ length: 5 }, (_, index) => ({
        span_id: `tool-${index}`, trace_id: 'trace-1', kind: 'tool',
        status: index === 4 ? 'error' : 'ok',
      })),
    }));
    expect(scores.find((score) => score.dimensionKey === 'efficiency')).toMatchObject({
      normalizedScore: 80, label: 'partial', applicability: 'applicable',
      rationale: '4/5 次工具执行成功；执行成功不代表工具选择或参数正确。',
    });
  });

  it('marks zero tool calls not_applicable instead of returning a perfect score', () => {
    expect(evaluateDeterministically(subject({ spans: [] }))
      .find((score) => score.dimensionKey === 'efficiency')).toMatchObject({
        normalizedScore: undefined, applicability: 'not_applicable', label: 'unknown',
      });
  });

  it('keeps tool execution success separate from tool selection and argument correctness', () => {
    const scores = evaluateDeterministically(subject({
      evaluationCase: {
        expected_labels: {
          toolCalls: [{ name: 'task_update_status', arguments: { status: 'done' } }],
        },
      },
      spans: [{
        span_id: 'tool-1', trace_id: 'trace-1', kind: 'tool', status: 'ok',
        attributes: { 'gen_ai.tool.name': 'task_update_status' },
      }],
      payloads: [{
        span_id: 'tool-1', role: 'tool_input', content: JSON.stringify({ status: 'blocked', taskId: 'task-1' }),
      }],
    }));

    expect(scores.find((score) => score.dimensionKey === 'efficiency')).toMatchObject({
      normalizedScore: 100, label: 'pass',
    });
    expect(scores.find((score) => score.dimensionKey === 'tool_correctness')).toMatchObject({
      normalizedScore: 0, label: 'fail', applicability: 'applicable',
    });
  });

  it('does not claim tool correctness without offline expectations', () => {
    expect(evaluateDeterministically(subject({
      spans: [{
        span_id: 'tool-1', trace_id: 'trace-1', kind: 'tool', status: 'ok',
        attributes: { 'gen_ai.tool.name': 'task_update_status' },
      }],
    })).find((score) => score.dimensionKey === 'tool_correctness')).toMatchObject({
      normalizedScore: undefined, label: 'unknown', applicability: 'not_applicable',
    });
  });

  it('keeps done, blocked, and cancelled outcomes distinct', () => {
    const scores = evaluateDeterministically(subject({
      tasks: [
        { id: 'done', status: 'done' },
        { id: 'blocked', status: 'blocked', blocked_reason: 'dependency unavailable' },
        { id: 'cancelled', status: 'cancelled' },
      ],
    }));
    const completion = scores.find((score) => score.dimensionKey === 'completion')!;
    expect(completion).toMatchObject({ label: 'partial', rationale: '完成率 1/3。' });
    expect(completion.normalizedScore).toBeCloseTo(100 / 3);
    const gate = scores.find((score) => score.dimensionKey === 'gate.task_completion')!;
    expect(gate.label).toBe('fail');
    expect(gate.normalizedScore).toBeCloseTo(100 / 3);
  });
});
