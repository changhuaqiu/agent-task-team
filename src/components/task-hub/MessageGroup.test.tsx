// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { groupMessagesIntoAgentResponses, MessageGroup } from './MessageGroup';
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

  it('shows only the active provisional projection while durable rows overlap it', () => {
    const overlappingMessages: ChatMessage[] = [
      {
        id: 'stream-1',
        conversationId: 'conversation-1',
        invocationId: 'invocation-live',
        agentId: 'peach',
        content: 'Live partial response',
        timestamp: '2026-07-30T02:30:00.000Z',
        isStreaming: true,
        toolEvents: [{
          id: 'live-tool',
          type: 'tool_use',
          label: 'Live Write',
          timestamp: '2026-07-30T02:30:01.000Z',
        }],
      },
      {
        id: 'durable-text',
        conversationId: 'conversation-1',
        invocationId: 'invocation-live',
        agentId: 'peach',
        content: 'Duplicated durable text',
        timestamp: '2026-07-30T02:30:02.000Z',
      },
      {
        id: 'durable-tool',
        conversationId: 'conversation-1',
        invocationId: 'invocation-live',
        agentId: 'peach',
        content: '',
        timestamp: '2026-07-30T02:30:03.000Z',
        toolEvents: [{
          id: 'persisted-tool',
          type: 'tool_use',
          label: 'Duplicated durable tool',
          timestamp: '2026-07-30T02:30:03.000Z',
        }],
      },
    ];

    render(
      <MessageGroup
        messages={overlappingMessages}
        themeColor="border-pink-500"
        agentEmoji="🌸"
        agentName="Peach"
        defaultExpanded={false}
        forceExpand
      />,
    );

    const response = screen.getByTestId('agent-response-invocation-live');
    expect(response.textContent).toContain('Live partial response');
    expect(response.textContent).toContain('Live Write');
    expect(response.textContent).not.toContain('Duplicated durable text');
    expect(response.textContent).not.toContain('Duplicated durable tool');
  });

  it('keeps special cards outside ordinary invocation segment grouping', () => {
    const ordinary = {
      id: 'ordinary',
      conversationId: 'conversation-1',
      invocationId: 'invocation-special',
      agentId: 'peach',
      content: 'Ordinary response',
      timestamp: '2026-07-30T02:30:00.000Z',
    } satisfies ChatMessage;
    const taskStatus = {
      id: 'task-status',
      conversationId: 'conversation-1',
      invocationId: 'invocation-special',
      agentId: 'peach',
      content: 'Task status projection',
      timestamp: '2026-07-30T02:30:01.000Z',
      intent: 'task_status',
      metadata: { taskId: 'TASK-1', title: 'Review', status: 'done' },
    } satisfies ChatMessage;

    expect(groupMessagesIntoAgentResponses([ordinary, taskStatus])).toHaveLength(2);
    expect(groupMessagesIntoAgentResponses([taskStatus, ordinary])).toHaveLength(2);
  });

  it('uses stable unique keys when an invocation id appears nonconsecutively', () => {
    const sequence = [
      { ...messages[0], id: 'inv-1-first', invocationId: 'inv-1' },
      { ...messages[0], id: 'inv-2-first', invocationId: 'inv-2' },
      { ...messages[0], id: 'inv-1-second', invocationId: 'inv-1' },
    ];

    expect(groupMessagesIntoAgentResponses(sequence).map((response) => response.id)).toEqual([
      'inv-1-first',
      'inv-2-first',
      'inv-1-second',
    ]);
  });
});
