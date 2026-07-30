// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectChatPanel } from '@/components/project/ProjectChatPanel';
import { useTaskHubStore } from '@/store/taskHubStore';

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

describe('ProjectChatPanel', () => {
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

    render(<ProjectChatPanel />);

    const chatViewport = screen.getByTestId('project-chat-viewport');
    const deliveryViewport = screen.getByTestId('autonomous-delivery-viewport');
    expect(chatViewport.className).toContain('min-h-0');
    expect(chatViewport.className).toContain('flex-1');
    expect(deliveryViewport.className).toContain('max-h-[40%]');
    expect(deliveryViewport.className).toContain('overflow-y-auto');
    expect(chatViewport.contains(screen.getByTestId('global-chat-room'))).toBe(true);
    expect(deliveryViewport.contains(screen.getByTestId('autonomous-delivery-panel'))).toBe(true);
  });
});
