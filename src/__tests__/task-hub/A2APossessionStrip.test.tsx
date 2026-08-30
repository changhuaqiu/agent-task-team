// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A2APossessionStrip } from '@/components/task-hub/A2APossessionStrip';
import { useTaskHubStore } from '@/store/taskHubStore';

beforeEach(() => {
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-receipt',
      title: 'Dispatch receipt',
      goal: 'Show dispatch receipt visibility',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-receipt',
    selectedProjectId: 'conv-receipt',
    activeAgentIds: ['mario', 'luigi'],
    currentTeamPack: null,
    dispatchReceiptsByConversation: {
      'conv-receipt': [{
        projectId: 'conv-receipt',
        receiptId: 'env-1:acknowledged',
        conversationId: 'conv-receipt',
        taskId: 'TASK-001',
        targetAgentId: 'mario',
        source: 'workflow',
        phase: 'acknowledged',
        createdAt: '2026-05-17T00:01:00.000Z',
      }],
    },
    a2aByConversation: {},
  });
});

afterEach(() => {
  cleanup();
});

describe('A2APossessionStrip', () => {
  it('surfaces dispatch receipt state even without an A2A handoff', () => {
    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByTestId('a2a-status-bar').className).toContain('border-b');
    expect(screen.getByTestId('a2a-status-summary').textContent).toMatch(/Mario.*已确认接纳/);
    expect(screen.getByText(/已确认接纳/)).toBeTruthy();
    expect(screen.getAllByText(/Mario/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/项目统筹/)).toBeNull();
  });

  it('uses the Agent identity instead of TeamPack member or snapshot names', () => {
    useTaskHubStore.setState({
      conversations: [{
        id: 'conv-receipt', title: 'Dispatch receipt', goal: '', status: 'active', priority: 'p1',
        projectPath: '', breakdownStatus: 'none', teamPackId: 'pack-receipt',
        createdAt: '2026-05-17T00:00:00.000Z', updatedAt: '2026-05-17T00:00:00.000Z',
      }],
      currentTeamPack: {
        id: 'pack-receipt', specVersion: 'team-pack/0.1', name: 'pack-receipt', displayName: 'Receipt team',
        description: '', version: '1.0.0', tags: [], category: 'test', teamMode: 'pipeline',
        workflow: { type: 'linear' }, communicationMatrix: {}, isPreset: false,
        createdAt: '2026-05-17T00:00:00.000Z', updatedAt: '2026-05-17T00:00:00.000Z',
        roles: [{ id: 'mario', displayName: 'Team Captain', required: true }],
      },
      activeAgentIds: ['mario'],
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getAllByText(/Mario/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Team Captain/)).toBeNull();
  });

  it('derives title and warning state from the newest record across both timelines', () => {
    useTaskHubStore.setState({
      a2aByConversation: {
        'conv-receipt': {
          conversationId: 'conv-receipt', chainId: 'chain-1', revision: 1,
          currentHolderIds: ['luigi'], status: 'active', updatedAt: '2026-05-17T00:00:00.000Z',
          handoffs: [{
            id: 'pass-old', chainId: 'chain-1', passId: 'pass-old', fromAgentId: 'human',
            toAgentId: 'luigi', status: 'blocked', intent: 'delegate', reason: '旧阻塞',
            timestamp: '2026-05-17T00:00:00.000Z',
          }],
        },
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByText(/Mario.*已确认接纳/)).toBeTruthy();
    expect(screen.queryByText(/Luigi.*已确认接纳/)).toBeNull();
    expect(screen.queryByText('旧阻塞')).toBeNull();
  });

  it('prefers acknowledgement over sent for the same envelope and timestamp', () => {
    useTaskHubStore.setState({
      a2aByConversation: {},
      dispatchReceiptsByConversation: {
        'conv-receipt': [
          {
            projectId: 'conv-receipt', receiptId: 'env-tied:sent', conversationId: 'conv-receipt',
            sourceMessageId: 'human-1', targetAgentId: 'mario', source: 'user', phase: 'sent',
            createdAt: '2026-05-17T00:02:00.000Z',
          },
          {
            projectId: 'conv-receipt', receiptId: 'env-tied:acknowledged', conversationId: 'conv-receipt',
            sourceMessageId: 'human-1', targetAgentId: 'mario', source: 'user', phase: 'acknowledged',
            createdAt: '2026-05-17T00:02:00.000Z',
          },
        ],
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByText(/Mario.*已确认接纳/)).toBeTruthy();
    expect(screen.queryByText(/Mario.*已送达/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '查看 Agent 交接记录' }));
    expect(screen.getByTestId('a2a-record-popover').className).toContain('top-full');
    expect(screen.getByTestId('a2a-record-popover').className).not.toContain('bottom-full');
  });

  it('stays scoped to the Project conversation when a child conversation is selected', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'child-task',
      dispatchReceiptsByConversation: {
        ...useTaskHubStore.getState().dispatchReceiptsByConversation,
        'child-task': [{
          projectId: 'conv-receipt', receiptId: 'child:rejected', conversationId: 'child-task',
          targetAgentId: 'luigi', source: 'workflow', phase: 'rejected',
          reasonCode: 'runtime_start_failed', createdAt: '2026-05-17T00:04:00.000Z',
        }],
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByText(/Mario.*已确认接纳/)).toBeTruthy();
    expect(screen.queryByText(/Luigi.*未接纳/)).toBeNull();
  });

  it('translates internal handoff reason codes before rendering them', () => {
    useTaskHubStore.setState({
      a2aByConversation: {
        'conv-receipt': {
          conversationId: 'conv-receipt', chainId: 'chain-2', revision: 2,
          currentHolderIds: [], status: 'aborted', updatedAt: '2026-05-17T00:03:00.000Z',
          handoffs: [{
            id: 'pass-failed', chainId: 'chain-2', passId: 'pass-failed', fromAgentId: 'human',
            toAgentId: 'luigi', status: 'error', intent: 'delegate', reason: 'runtime_transport_lost',
            timestamp: '2026-05-17T00:03:00.000Z',
          }],
        },
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByText('Agent 连接已中断')).toBeTruthy();
    expect(screen.queryByText('runtime_transport_lost')).toBeNull();
  });

  it('surfaces a newer Runtime failure in the top status bar', () => {
    useTaskHubStore.setState({
      eventsByConversation: {
        'conv-receipt': [{
          id: 'run-failed-1',
          conversationId: 'conv-receipt',
          type: 'run.finished',
          timestamp: '2026-05-17T00:05:00.000Z',
          payload: {
            runId: 'run-1',
            agentId: 'luigi',
            taskId: 'TASK-002',
            code: 1,
            reasonCode: 'runtime_model_unavailable',
          },
        }],
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByTestId('a2a-status-summary').textContent).toMatch(/Luigi.*运行失败/);
    expect(screen.getByText('所选模型当前不可用，请检查 Agent 的账号与模型')).toBeTruthy();
    expect(screen.queryByText('runtime_model_unavailable')).toBeNull();
  });

  it('clears a stale Runtime failure after a newer successful run', () => {
    useTaskHubStore.setState({
      eventsByConversation: {
        'conv-receipt': [
          {
            id: 'run-failed-old', conversationId: 'conv-receipt', type: 'run.finished',
            timestamp: '2026-05-17T00:05:00.000Z',
            payload: { runId: 'run-old', agentId: 'luigi', code: 1, reasonCode: 'runtime_start_failed' },
          },
          {
            id: 'run-success-new', conversationId: 'conv-receipt', type: 'run.finished',
            timestamp: '2026-05-17T00:06:00.000Z',
            payload: { runId: 'run-new', agentId: 'luigi', code: 0 },
          },
        ],
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);

    expect(screen.getByTestId('a2a-status-summary').textContent).toMatch(/Mario.*已确认接纳/);
    expect(screen.queryByText(/Luigi.*运行失败/)).toBeNull();
  });

  it('resets an open record popover when the Project conversation changes', () => {
    useTaskHubStore.setState({
      dispatchReceiptsByConversation: {
        'conv-receipt': [
          ...useTaskHubStore.getState().dispatchReceiptsByConversation['conv-receipt'],
          {
            projectId: 'conv-receipt', receiptId: 'env-2:sent', conversationId: 'conv-receipt',
            targetAgentId: 'mario', source: 'workflow', phase: 'sent',
            createdAt: '2026-05-17T00:02:00.000Z',
          },
        ],
        'project-b': [{
          projectId: 'project-b', receiptId: 'env-b:sent', conversationId: 'project-b',
          targetAgentId: 'luigi', source: 'workflow', phase: 'sent',
          createdAt: '2026-05-17T00:03:00.000Z',
        }],
      },
    });
    const { rerender } = render(<A2APossessionStrip conversationId="conv-receipt" />);
    fireEvent.click(screen.getByRole('button', { name: '查看 Agent 交接记录' }));
    expect(screen.getByTestId('a2a-record-popover')).toBeTruthy();

    rerender(<A2APossessionStrip conversationId="project-b" />);

    expect(screen.queryByTestId('a2a-record-popover')).toBeNull();
    expect(screen.queryByRole('button', { name: '查看 Agent 交接记录' })).toBeNull();
  });

  it('keeps the complete mixed history available in the record popover', () => {
    useTaskHubStore.setState({
      a2aByConversation: {
        'conv-receipt': {
          conversationId: 'conv-receipt', chainId: 'chain-history', revision: 1,
          currentHolderIds: ['luigi'], status: 'active', updatedAt: '2026-05-17T00:24:00.000Z',
          handoffs: [{
            id: 'pass-history', chainId: 'chain-history', passId: 'pass-history',
            fromAgentId: 'human', toAgentId: 'luigi', status: 'offered', intent: 'delegate',
            timestamp: '2026-05-17T00:24:00.000Z',
          }],
        },
      },
      dispatchReceiptsByConversation: {
        'conv-receipt': Array.from({ length: 23 }, (_, index) => ({
          projectId: 'conv-receipt', receiptId: `env-${index}:sent`, conversationId: 'conv-receipt',
          targetAgentId: 'mario', source: 'workflow' as const, phase: 'sent' as const,
          createdAt: new Date(Date.UTC(2026, 4, 17, 0, index)).toISOString(),
        })),
      },
    });

    render(<A2APossessionStrip conversationId="conv-receipt" />);
    fireEvent.click(screen.getByRole('button', { name: '查看 Agent 交接记录' }));

    expect(screen.getAllByText(/派发回执:/)).toHaveLength(23);
    expect(screen.getByText('已发起交接')).toBeTruthy();
  });
});
