// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectEvaluationWorkspace } from '@/components/project/ProjectEvaluationWorkspace';
import axe from 'axe-core';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe('ProjectEvaluationWorkspace', () => {
  it('clears the previous project objects before a failing project load', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('conversationId=conv-a')) {
        if (url.includes('/datasets')) {
          return jsonResponse({
            datasets: [{
              id: 'dataset-a', name: 'Dataset A', description: 'A only',
              revision: 1, status: 'active', case_count: 1,
            }],
          });
        }
        if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
        if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
        return jsonResponse({ proposals: [] });
      }
      return jsonResponse({ error: 'Project B unavailable' }, false);
    });

    const view = render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(screen.getByRole('button', { name: /数据集/ }));
    expect(await screen.findByText(/Dataset A/)).toBeDefined();

    view.rerender(<ProjectEvaluationWorkspace conversationId="conv-b"/>);
    await waitFor(() => expect(screen.queryByText(/Dataset A/)).toBeNull());
    expect(await screen.findByText('Project B unavailable')).toBeDefined();
  });

  it('resolves case-promotion reviews and submits draft proposals from the platform workspace', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') return jsonResponse({ ok: true });
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) {
        return jsonResponse({
          reviews: [{
            id: 'review-1', reason_code: 'case_promotion', created_at: '2026-07-19T00:00:00.000Z',
            request_payload: { caseKey: 'online-failure-1', split: 'tune' },
          }],
        });
      }
      return jsonResponse({
        proposals: [{
          id: 'proposal-1', hypothesis: 'Add verification', proposed_change: 'Candidate RoleCard',
          risk: 'medium', status: 'draft', updated_at: '2026-07-19T00:00:00.000Z',
        }],
      });
    });

    render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: /待复核/ }));
    expect(await screen.findByText('线上失败案例晋升')).toBeDefined();
    fireEvent.change(screen.getByLabelText('复核依据 review-1'), {
      target: { value: 'Evidence is redacted and suitable for tune.' },
    });
    fireEvent.click(screen.getByRole('button', { name: '批准晋升' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => {
      if (init?.method !== 'PATCH') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.action === 'review_case_promotion' && body.approved === true;
    })).toBe(true));

    fireEvent.click(screen.getByRole('button', { name: /改进提案/ }));
    fireEvent.click(await screen.findByRole('button', { name: '提交复核' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => {
      if (init?.method !== 'PATCH') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.action === 'submit' && body.id === 'proposal-1';
    })).toBe(true));
  });

  it('freezes baseline and candidate snapshots before starting a runner experiment', async () => {
    const snapshots: Array<Record<string, unknown>> = [];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST' && url.includes('/application-snapshots')) {
        const request = JSON.parse(String(init.body)) as Record<string, string>;
        const snapshot = {
          id: `snapshot-${request.source}`,
          name: request.name,
          source: request.source,
          code_revision: '1234567890abcdef',
          created_at: '2026-07-19T00:00:00.000Z',
        };
        snapshots.push(snapshot);
        return jsonResponse({ snapshot });
      }
      if (init?.method === 'POST' && url.includes('/experiments')) {
        return jsonResponse({ experiment: { id: 'experiment-runner', status: 'running' } });
      }
      if (url.includes('/datasets')) {
        return jsonResponse({ datasets: [{
          id: 'dataset-held', name: 'Held-out', description: 'release',
          revision: 1, status: 'active', case_count: 12,
        }] });
      }
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });

    render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: /对比实验/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));

    fireEvent.change(screen.getByLabelText('版本名称'), { target: { value: '发布版' } });
    fireEvent.click(screen.getByRole('button', { name: '冻结为基线' }));
    await screen.findByText('基线版本已冻结。');

    fireEvent.change(screen.getByLabelText('版本名称'), { target: { value: '候选修复' } });
    fireEvent.click(screen.getByRole('button', { name: '冻结为候选' }));
    await screen.findByText('候选版本已冻结。');

    fireEvent.change(screen.getByLabelText('实验名称'), { target: { value: '修复回归' } });
    fireEvent.change(screen.getByLabelText('held-out 数据集'), { target: { value: 'dataset-held' } });
    fireEvent.change(screen.getByLabelText('基线版本'), { target: { value: 'snapshot-published' } });
    fireEvent.change(screen.getByLabelText('候选版本'), { target: { value: 'snapshot-candidate' } });
    fireEvent.click(screen.getByRole('button', { name: '启动隔离对比' }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (String(input) !== '/api/eval/experiments' || init?.method !== 'POST') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.baselineSnapshotId === 'snapshot-published'
        && body.candidateSnapshotId === 'snapshot-candidate'
        && body.datasetId === 'dataset-held';
    })).toBe(true));
    expect(await screen.findByText('对比实验已进入 Harness 隔离执行队列。')).toBeDefined();
  });

  it('requires explicit single-operator confirmation before proposal approval and apply', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'PATCH') return jsonResponse({ proposal: { id: 'updated' } });
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) {
        return jsonResponse({
          experiments: [{
            id: 'experiment-good', name: '可信回归', status: 'completed',
            created_at: '2026-07-19T00:00:00.000Z',
            summary: { conclusion: 'candidate_improves', executionVerified: true },
          }],
        });
      }
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({
        proposals: [
          {
            id: 'proposal-review', hypothesis: '批准候选规则', proposed_change: 'Candidate RoleCard',
            risk: 'medium', status: 'in_review', updated_at: '2026-07-19T00:00:00.000Z',
          },
          {
            id: 'proposal-approved', hypothesis: '应用候选规则', proposed_change: 'Candidate Skill',
            risk: 'medium', status: 'approved', regression_experiment_id: 'experiment-good',
            approval_by: 'platform-operator', updated_at: '2026-07-19T00:00:00.000Z',
          },
        ],
      });
    });

    render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: /改进提案/ }));

    fireEvent.change(screen.getByLabelText('held-out 回归实验 批准候选规则'), {
      target: { value: 'experiment-good' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }));
    expect(screen.getByText('请先完成单一平台操作者明确确认。')).toBeDefined();

    fireEvent.click(screen.getByLabelText('单一平台操作者确认 批准候选规则'));
    fireEvent.click(screen.getByRole('button', { name: '确认批准' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => {
      if (init?.method !== 'PATCH') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.action === 'approve'
        && body.operatorConfirmed === true
        && body.regressionExperimentId === 'experiment-good';
    })).toBe(true));

    fireEvent.click(screen.getByLabelText('单一平台操作者确认 应用候选规则'));
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => {
      if (init?.method !== 'PATCH') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.action === 'apply'
        && body.operatorConfirmed === true
        && body.regressionExperimentId === 'experiment-good';
    })).toBe(true));
  });

  it('keeps the integrated evaluation creator free of detectable accessibility violations', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });
    const view = render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: /对比实验/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始创建' }));
    const result = await axe.run(view.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });

  it('leads with an understandable decision and progressively discloses raw scoring evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/eval/runs/run-simple')) {
        return jsonResponse({
          run: {
            id: 'run-simple', status: 'partial', gate_status: 'unknown',
            overall_score: 92.2, evidence_coverage: 0.78,
            error_message: '未配置评估账号。', created_at: '2026-07-19T00:00:00.000Z',
          },
          snapshot: {
            data_quality: { missing: ['tasks', 'skill_revision'], truncated: ['$.payloads[1].content'] },
            evidence_refs: [{ kind: 'span', id: 'span-1', traceId: 'trace-1' }],
          },
          scores: [
            {
              id: 'gate-completion', dimension_key: 'gate.task_completion', evaluator_kind: 'gate',
              applicability: 'unknown', label: 'unknown', rationale: '没有冻结到任务事实。',
              evidence_refs: [],
            },
            {
              id: 'gate-safety', dimension_key: 'gate.safety', evaluator_kind: 'gate',
              applicability: 'not_applicable', label: 'unknown', rationale: '没有显式安全证明源。',
              evidence_refs: [],
            },
            {
              id: 'score-efficiency', dimension_key: 'efficiency', evaluator_kind: 'deterministic',
              applicability: 'applicable', label: 'pass', normalized_score: 100,
              rationale: '35/35 次工具执行成功。', evidence_refs: [{ kind: 'span', id: 'span-1', traceId: 'trace-1' }],
            },
            {
              id: 'score-reliability', dimension_key: 'reliability', evaluator_kind: 'deterministic',
              applicability: 'applicable', label: 'partial', normalized_score: 85.714,
              rationale: '1/7 次调用失败。', evidence_refs: [],
            },
            {
              id: 'score-correctness', dimension_key: 'correctness', evaluator_kind: 'judge',
              applicability: 'unknown', label: 'unknown', rationale: 'Judge 不可用。', evidence_refs: [],
            },
          ],
          gaps: [],
        });
      }
      if (url.includes('/api/eval/runs?')) {
        return jsonResponse({
          runs: [{
            id: 'run-simple', status: 'partial', gate_status: 'unknown',
            overall_score: 92.2, evidence_coverage: 0.78, created_at: '2026-07-19T00:00:00.000Z',
          }],
        });
      }
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });

    const view = render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    expect(await screen.findByRole('heading', { name: '证据不足' })).toBeDefined();
    expect(screen.getByText('已评维度得分 92.2')).toBeDefined();
    expect(screen.queryByText('综合分')).toBeNull();
    expect(screen.getByText('为什么')).toBeDefined();
    expect(screen.getAllByText('工具执行成功率').length).toBeGreaterThan(0);
    expect(screen.getByText('只展示当前有充分数据的指标')).toBeDefined();

    const detailsSummary = screen.getByText('完整评分与证据');
    const details = detailsSummary.closest('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(detailsSummary);
    expect(details.open).toBe(true);
    expect(screen.getByText('全部关键条件')).toBeDefined();
    expect(screen.getByText('1 条内容因长度限制被截断')).toBeDefined();
    const accessibility = await axe.run(view.container, {
      rules: { 'color-contrast': { enabled: false } },
    });
    expect(accessibility.violations).toEqual([]);
  });

  it('submits and replays evaluations through the canonical run endpoints', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === 'POST') return jsonResponse({ accepted: true });
      if (url.includes('/api/eval/runs/run-actions')) {
        return jsonResponse({
          run: {
            id: 'run-actions', status: 'completed', gate_status: 'pass',
            overall_score: 100, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          },
          snapshot: { data_quality: { missing: [], truncated: [] } },
          scores: [],
          gaps: [],
        });
      }
      if (url.includes('/api/eval/runs?')) {
        return jsonResponse({
          runs: [{
            id: 'run-actions', status: 'completed', gate_status: 'pass',
            overall_score: 100, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          }],
        });
      }
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });

    render(<ProjectEvaluationWorkspace conversationId="conv-actions"/>);
    expect(await screen.findByRole('heading', { name: '通过' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: '重新诊断' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (String(input) !== '/api/eval/runs' || init?.method !== 'POST') return false;
      return JSON.parse(String(init.body)).conversationId === 'conv-actions';
    })).toBe(true));

    fireEvent.click(screen.getByText('完整评分与证据'));
    fireEvent.click(screen.getByRole('button', { name: '按冻结证据重放' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (String(input) !== '/api/eval/runs/run-actions/replay' || init?.method !== 'POST') return false;
      return JSON.parse(String(init.body)).conversationId === 'conv-actions';
    })).toBe(true));
  });

  it('opens existing observability drill-down from task evidence', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/api/eval/runs/run-1')) {
        return jsonResponse({
          run: {
            id: 'run-1', status: 'completed', gate_status: 'pass',
            overall_score: 100, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          },
          snapshot: { data_quality: { missing: [], truncated: [] } },
          scores: [{
            id: 'score-1', dimension_key: 'completion', evaluator_kind: 'deterministic',
            label: 'pass', normalized_score: 100, rationale: 'done',
            evidence_refs: [{ kind: 'task', id: 'task-1', taskId: 'task-1' }],
          }],
          gaps: [],
        });
      }
      if (url.includes('/api/eval/runs?')) {
        return jsonResponse({
          runs: [{
            id: 'run-1', status: 'completed', gate_status: 'pass',
            overall_score: 100, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          }],
        });
      }
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });
    let opened: unknown;
    const listener = (event: Event) => {
      opened = (event as CustomEvent).detail;
    };
    window.addEventListener('observability:open', listener);
    render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: 'task:task-1' }));
    expect(opened).toMatchObject({ conversationId: 'conv-a', taskId: 'task-1' });
    window.removeEventListener('observability:open', listener);
  });

  it('creates a draft proposal from a result gap without directly applying a change', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === '/api/eval/proposals' && init?.method === 'POST') {
        return jsonResponse({ proposal: { id: 'proposal-created', status: 'draft' } });
      }
      if (url.includes('/api/eval/runs/run-gap')) {
        return jsonResponse({
          run: {
            id: 'run-gap', status: 'completed', gate_status: 'partial',
            overall_score: 80, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          },
          snapshot: { data_quality: { missing: [], truncated: [] } },
          scores: [],
          gaps: [{
            id: 'gap-1', severity: 'medium', dimension_key: 'reliability',
            description: 'Tool failures remain', suggestion: 'Add deterministic retry verification',
          }],
        });
      }
      if (url.includes('/api/eval/runs?')) {
        return jsonResponse({
          runs: [{
            id: 'run-gap', status: 'completed', gate_status: 'partial',
            overall_score: 80, evidence_coverage: 1, created_at: '2026-07-19T00:00:00.000Z',
          }],
        });
      }
      if (url.includes('/datasets')) return jsonResponse({ datasets: [] });
      if (url.includes('/application-snapshots')) return jsonResponse({ snapshots: [] });
      if (url.includes('/experiments')) return jsonResponse({ experiments: [] });
      if (url.includes('/reviews')) return jsonResponse({ reviews: [] });
      return jsonResponse({ proposals: [] });
    });

    render(<ProjectEvaluationWorkspace conversationId="conv-a"/>);
    fireEvent.click(await screen.findByRole('button', { name: '生成改进提案' }));
    expect(await screen.findByText(/已生成 draft 改进提案/)).toBeDefined();
    expect(fetchMock.mock.calls.some(([input, init]) => {
      if (String(input) !== '/api/eval/proposals' || init?.method !== 'POST') return false;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      return body.gapId === 'gap-1'
        && body.targetType === 'evaluation_policy'
        && body.proposedChange === 'Add deterministic retry verification';
    })).toBe(true);
  });
});
