// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeliveryWorkspaceView } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';
import { DeliveryWorkspaceOverview } from './DeliveryWorkspaceOverview';

afterEach(cleanup);

function evidenceView(): DeliveryWorkspaceView {
  return {
    project: { path: 'C:\\workspace\\agent-task-team', name: 'agent-task-team' },
    delivery: {
      id: 'delivery-1',
      title: '证据链改造',
      goal: '让每条验收结论都能追溯',
      status: 'completed',
      priority: 'p1',
      autonomous: true,
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
    stage: 'completed',
    acceptance: {
      criteria: ['构建通过', '浏览器验收通过'],
      evidence: [
        { criterion: '构建通过', status: 'passed', evidenceRefs: ['report:build-1'] },
        { criterion: '浏览器验收通过', status: 'pending', evidenceRefs: [] },
      ],
      total: 2,
      passed: 1,
      failed: 0,
      pending: 1,
      verification: {
        method: 'automated_test',
        verifierAgentId: 'peach',
        tool: 'pnpm test',
        reportRef: 'reports/verification.md',
        specRefs: ['specs/frontend-architecture-refactor/spec.md'],
        codeRevision: 'abc1234',
        completedAt: '2026-08-20T00:00:00.000Z',
      },
    },
    work: {
      tasks: [], current: [], total: 0, completed: 0, inProgress: 0, blocked: 0,
      terminalProjectionConflict: false,
    },
    attention: [],
    recentActivity: [],
  };
}

describe('DeliveryWorkspaceOverview', () => {
  it('keeps acceptance evidence compact and reveals the formal proof packet', () => {
    render(<DeliveryWorkspaceOverview view={evidenceView()} />);

    expect(screen.getByText('1/2 条已验证 · 展开查看')).toBeDefined();
    const details = screen.getByText('验收证据').closest('details');
    expect(details?.open).toBe(false);

    fireEvent.click(screen.getByText('验收证据'));

    expect(details?.open).toBe(true);
    expect(screen.getByText('这里只计算正式验收记录；Agent 在聊天中的口头说明不计入结果。')).toBeDefined();
    expect(screen.getByText('report:build-1')).toBeDefined();
    expect(screen.getByText('尚未形成正式证据。')).toBeDefined();
    expect(screen.getByText('自动化测试')).toBeDefined();
    expect(screen.getByText('reports/verification.md')).toBeDefined();
    expect(screen.getByText('abc1234')).toBeDefined();
  });

  it('shows when optional verification provenance was not recorded', () => {
    const view = evidenceView();
    view.acceptance.verification = {
      ...view.acceptance.verification!,
      specRefs: [],
      codeRevision: undefined,
    };

    render(<DeliveryWorkspaceOverview view={view} />);
    fireEvent.click(screen.getByText('验收证据'));

    expect(screen.getAllByText('未记录')).toHaveLength(2);
  });
});
