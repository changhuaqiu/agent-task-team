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

  it('renders one ordered response container for segments from the same invocation', () => {
    const invocationMessages: ChatMessage[] = [
      {
        id: 'segment-text-1',
        conversationId: 'conversation-1',
        invocationId: 'invocation-1',
        agentId: 'peach',
        content: 'First progress update',
        timestamp: '2026-07-30T02:30:00.000Z',
      },
      {
        id: 'segment-tool-1',
        conversationId: 'conversation-1',
        invocationId: 'invocation-1',
        agentId: 'peach',
        content: '',
        timestamp: '2026-07-30T02:30:01.000Z',
        toolEvents: [{
          id: 'tool-1',
          type: 'tool_use',
          label: 'Write',
          timestamp: '2026-07-30T02:30:01.000Z',
        }],
      },
      {
        id: 'segment-text-2',
        conversationId: 'conversation-1',
        invocationId: 'invocation-1',
        agentId: 'peach',
        content: 'Final response',
        timestamp: '2026-07-30T02:30:02.000Z',
      },
    ];

    render(
      <MessageGroup
        messages={invocationMessages}
        themeColor="border-pink-500"
        agentEmoji="🌸"
        agentName="Peach"
        defaultExpanded={false}
      />,
    );

    const response = screen.getByTestId('agent-response-invocation-1');
    expect(response.textContent).toContain('First progress update');
    expect(response.textContent).toContain('Write');
    expect(response.textContent).toContain('Final response');
    expect(response.textContent!.indexOf('First progress update')).toBeLessThan(response.textContent!.indexOf('Write'));
    expect(response.textContent!.indexOf('Write')).toBeLessThan(response.textContent!.indexOf('Final response'));
    expect(screen.queryByRole('button', { name: /Peach.*展开/ })).toBeNull();
  });
});
