// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectChatPanel } from '@/components/project/ProjectChatPanel';
import { useTaskHubStore } from '@/store/taskHubStore';
import { projectDeliveryWorkspace } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';
import type { DeliveryRunSnapshot } from '@/server/autonomous-delivery/types';

vi.mock('@/components/task-hub/GlobalChatRoom', () => ({
  GlobalChatRoom: () => <div data-testid="global-chat-room" />,
}));

vi.mock('@/components/task-hub/AgentBar', () => ({
  AgentBar: () => <div data-testid="agent-bar" />,
}));

vi.mock('@/components/project/AutonomousDeliveryPanel', () => ({
  AutonomousDeliveryPanel: () => <div data-testid="autonomous-delivery-panel" />,
}));

afterEach(cleanup);

function workspaceView(deliveryRunSnapshot?: DeliveryRunSnapshot) {
  const state = useTaskHubStore.getState();
  return projectDeliveryWorkspace({
    conversations: state.conversations,
    tasks: state.tasks,
    blockersByConversation: state.blockersByConversation,
    chatMessagesByConversation: state.chatMessagesByConversation,
    deliveryRunSnapshot,
  }, state.selectedConversationId);
}

describe('ProjectChatPanel', () => {
  it('renders one delivery empty state without mounting team activity', () => {
    render(<ProjectChatPanel view={null} />);

    expect(screen.getByTestId('delivery-empty-state')).toBeDefined();
    expect(screen.getByText('从一个交付开始')).toBeDefined();
    expect(screen.queryByTestId('agent-bar')).toBeNull();
    expect(screen.queryByTestId('global-chat-room')).toBeNull();
  });

  it('keeps the chat viewport in the remaining bounded height below delivery status', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-layout',
      conversations: [{
        id: 'conv-layout',
        title: 'Layout regression',
        goal: '',
        status: 'active',
        priority: 'p1',
        projectPath: '',
        breakdownStatus: 'none',
        createdAt: '2026-07-26T00:00:00.000Z',
        updatedAt: '2026-07-26T00:00:00.000Z',
      }],
      tasks: [],
    });

    render(<ProjectChatPanel view={workspaceView()} />);

    const chatViewport = screen.getByTestId('project-chat-viewport');
    const deliveryViewport = screen.getByTestId('autonomous-delivery-viewport');
    expect(chatViewport.className).toContain('min-h-0');
    expect(chatViewport.className).toContain('flex-1');
    expect(deliveryViewport.className).toContain('max-h-[32%]');
    expect(deliveryViewport.className).toContain('overflow-y-auto');
    expect(chatViewport.contains(screen.getByTestId('global-chat-room'))).toBe(true);
    expect(deliveryViewport.contains(screen.getByTestId('autonomous-delivery-panel'))).toBe(true);
  });

  it('answers stage, acceptance, current work, and attention on the first screen', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-overview',
      conversations: [{
        id: 'conv-overview',
        title: 'Overview delivery',
        goal: 'Make progress legible',
        status: 'active',
        priority: 'p1',
        projectPath: 'C:/projects/overview',
        breakdownStatus: 'confirmed',
        autonomous: true,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
      }],
      tasks: [{
        id: 'TASK-CURRENT',
        conversationId: 'conv-overview',
        phaseId: '',
        title: 'Wire acceptance projection',
        description: '',
        status: 'in_progress',
        agentId: 'luigi',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
        revision: 0,
      }],
      blockersByConversation: { 'conv-overview': [] },
      chatMessagesByConversation: { 'conv-overview': [] },
    });

    const snapshot = {
      run: {
        id: 'run-overview',
        conversation_id: 'conv-overview',
        status: 'active',
        current_stage: 'verifying',
      },
      contract: { acceptanceCriteria: ['Unit tests pass', 'Browser E2E passes'] },
      bundle: {
        acceptanceResults: [{
          criterion: 'Unit tests pass',
          status: 'passed',
          evidenceRefs: ['test:unit'],
        }],
      },
    } as unknown as DeliveryRunSnapshot;
    render(<ProjectChatPanel view={workspaceView(snapshot)} />);

    expect(screen.getByText('验收中')).toBeTruthy();
    expect(screen.getByText('0/2')).toBeTruthy();
    expect(screen.getByText('任务')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
    expect(screen.getByText('当前工作：Wire acceptance projection')).toBeTruthy();
    expect(screen.getByText('需关注')).toBeTruthy();
  });

  it('does not downgrade completed acceptance while a historical Task is being reconciled', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-terminal-conflict',
      conversations: [{
        id: 'conv-terminal-conflict',
        title: 'Completed delivery',
        goal: 'Keep terminal truth stable',
        status: 'completed',
        priority: 'p1',
        projectPath: 'C:/projects/completed',
        breakdownStatus: 'confirmed',
        autonomous: true,
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T01:00:00.000Z',
      }],
      tasks: [{
        id: 'TASK-STALE',
        conversationId: 'conv-terminal-conflict',
        phaseId: '',
        title: 'Historically reviewed task',
        description: '',
        status: 'in_progress',
        agentId: 'luigi',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-08-19T00:00:00.000Z',
        updatedAt: '2026-08-19T01:00:00.000Z',
        revision: 5,
      }],
      blockersByConversation: { 'conv-terminal-conflict': [] },
      chatMessagesByConversation: { 'conv-terminal-conflict': [] },
    });

    const snapshot = {
      run: {
        id: 'run-completed',
        conversation_id: 'conv-terminal-conflict',
        status: 'completed',
        current_stage: 'delivering',
      },
      contract: { acceptanceCriteria: ['Review passed'] },
      bundle: {
        acceptanceResults: [{
          criterion: 'Review passed',
          status: 'passed',
          evidenceRefs: ['review:task-stale'],
        }],
      },
    } as unknown as DeliveryRunSnapshot;
    render(<ProjectChatPanel view={workspaceView(snapshot)} />);

    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.getByText('1/1')).toBeTruthy();
    expect(screen.getByText('0/1')).toBeTruthy();
    expect(screen.getByText('需核对')).toBeTruthy();
    expect(screen.getByText('交付和验收已完成；任务明细仍有未完成项，需核对。')).toBeTruthy();
  });
});
