// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MessageGroup } from './MessageGroup';
import type { ChatMessage } from '@/store/taskHubStore';

afterEach(cleanup);

const messages: ChatMessage[] = [
  {
    id: 'message-1',
    conversationId: 'conversation-1',
    agentId: 'peach',
    content: '第一条历史消息',
    timestamp: '2026-07-30T02:30:00.000Z',
  },
  {
    id: 'message-2',
    conversationId: 'conversation-1',
    agentId: 'peach',
    content: '第二条历史消息',
    timestamp: '2026-07-30T02:31:00.000Z',
  },
];

describe('MessageGroup', () => {
  it('keeps completed agent history collapsed until the user expands it', () => {
    render(
      <MessageGroup
        messages={messages}
        themeColor="border-pink-500"
        agentEmoji="🌸"
        agentName="Peach"
        defaultExpanded={false}
      />,
    );

    expect(screen.queryByText('第一条历史消息')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Peach.*展开/ }));
    expect(screen.getByText('第一条历史消息')).toBeDefined();
    expect(screen.getByText('第二条历史消息')).toBeDefined();
  });
});
