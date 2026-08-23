// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTaskHubStore } from '@/store/taskHubStore';
import { GlobalChatRoom, INITIAL_TIMELINE_ITEM_LIMIT } from '@/components/task-hub/GlobalChatRoom';

vi.mock('@/components/task-hub/ChatMessageItem', () => ({
  ChatMessageItem: ({ message }: { message: { id: string } }) => (
    <div data-testid="timeline-message">{message.id}</div>
  ),
}));
vi.mock('@/components/task-hub/ChatActivityNotice', () => ({
  ChatActivityNotice: ({ message }: { message: { id: string } }) => (
    <div data-testid="timeline-activity">{message.id}</div>
  ),
}));
vi.mock('@/components/task-hub/ChatFilterBar', () => ({
  ChatFilterBar: () => <div data-testid="chat-filter" />,
}));
vi.mock('@/components/task-hub/AgentMentionPopup', () => ({
  AgentMentionPopup: () => null,
}));
vi.mock('@/components/task-hub/A2APossessionStrip', () => ({
  A2APossessionStrip: () => null,
}));
vi.mock('@/components/ui/EmojiPickerButton', () => ({
  EmojiPickerButton: () => <button type="button">表情</button>,
}));
vi.mock('@/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isAtBottom: true, scrollToBottom: vi.fn() }),
}));

afterEach(cleanup);

describe('GlobalChatRoom performance window', () => {
  it('renders a bounded recent timeline and reveals older batches on demand', () => {
    const total = INITIAL_TIMELINE_ITEM_LIMIT + 10;
    useTaskHubStore.setState({
      selectedConversationId: 'conv-performance',
      chatMessagesByConversation: {
        'conv-performance': Array.from({ length: total }, (_, index) => ({
          id: `message-${index}`,
          agentId: 'mario',
          content: `Update ${index}`,
          timestamp: new Date(Date.UTC(2026, 7, 20, 0, 0, index)).toISOString(),
          conversationId: 'conv-performance',
          invocationId: `invocation-${index}`,
          mentions: [],
          intent: 'general',
        })),
      },
      runtimeRefreshInProgress: false,
    });

    render(<GlobalChatRoom variant="embedded" />);

    expect(screen.getAllByTestId('timeline-message')).toHaveLength(INITIAL_TIMELINE_ITEM_LIMIT);
    fireEvent.click(screen.getByRole('button', { name: '显示更早的 10 条活动' }));
    expect(screen.getAllByTestId('timeline-message')).toHaveLength(total);
  });
});
