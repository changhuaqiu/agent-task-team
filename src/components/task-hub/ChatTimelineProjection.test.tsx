// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useTaskHubStore, type ChatMessage } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';
import { ChatActivityNotice } from './ChatActivityNotice';
import { projectChatTimeline } from './chatTimelineProjection';

beforeEach(() => {
  useTaskHubStore.setState({
    selectedConversationId: 'conversation-1',
    dispatchReceiptsByConversation: {},
  });
});

afterEach(cleanup);

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'agentId' | 'content'>): ChatMessage {
  return {
    timestamp: '2026-07-30T02:30:00.000Z',
    conversationId: 'conversation-1',
    ...input,
  };
}

describe('projectChatTimeline', () => {
  it('keeps one stable response per invocation when parallel agents interleave', () => {
    const timeline = projectChatTimeline([
      message({ id: 'mario-start', agentId: 'mario', invocationId: 'inv-mario', content: '开始处理' }),
      message({ id: 'peach-start', agentId: 'peach', invocationId: 'inv-peach', content: '开始评审' }),
      message({ id: 'mario-tool', agentId: 'mario', invocationId: 'inv-mario', content: '', toolEvents: [{
        id: 'tool-write', type: 'tool_use', label: 'Write', timestamp: '2026-07-30T02:30:01.000Z',
      }] }),
      message({ id: 'mario-final', agentId: 'mario', invocationId: 'inv-mario', content: '处理完成' }),
      message({ id: 'peach-final', agentId: 'peach', invocationId: 'inv-peach', content: '评审完成' }),
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ kind: 'response', id: 'invocation:inv-mario' });
    expect(timeline[0].kind === 'response' && timeline[0].messages.map((item) => item.id)).toEqual([
      'mario-start', 'mario-tool', 'mario-final',
    ]);
    expect(timeline[1].kind === 'response' && timeline[1].messages.map((item) => item.id)).toEqual([
      'peach-start', 'peach-final',
    ]);
  });

  it('does not merge separate invocations from the same agent', () => {
    const timeline = projectChatTimeline([
      message({ id: 'first', agentId: 'peach', invocationId: 'inv-1', content: '第一次评审' }),
      message({ id: 'second', agentId: 'peach', invocationId: 'inv-2', content: '第二次评审' }),
    ]);

    expect(timeline.map((item) => item.id)).toEqual(['invocation:inv-1', 'invocation:inv-2']);
  });

  it('projects task and system messages as activities outside agent responses', () => {
    const timeline = projectChatTimeline([
      message({ id: 'task-event', agentId: 'task-notifier', intent: 'task_status', content: '状态 in_progress → in_review' }),
      message({ id: 'system-event', agentId: 'system', content: '系统已恢复' }),
    ]);

    expect(timeline.map((item) => item.kind)).toEqual(['activity', 'activity']);
  });

  it('collapses repeated observation noise but keeps command facts distinct', () => {
    const timeline = projectChatTimeline([
      message({ id: 'sync-1', agentId: 'system', content: '“测试”有新活动', metadata: { kind: 'task.synced', taskId: 'work-1' } }),
      message({ id: 'sync-2', agentId: 'system', content: '“测试”有新活动', timestamp: '2026-07-30T02:32:00.000Z', metadata: { kind: 'task.synced', taskId: 'work-1' } }),
      message({ id: 'fact-1', agentId: 'system', content: '工作已创建', timestamp: '2026-07-30T02:33:00.000Z', metadata: { factType: 'work.created', commandId: 'cmd-1' } }),
      message({ id: 'fact-2', agentId: 'system', content: '工作已创建', timestamp: '2026-07-30T02:34:00.000Z', metadata: { factType: 'work.created', commandId: 'cmd-2' } }),
    ]);

    expect(timeline).toHaveLength(3);
    expect(timeline[0]).toMatchObject({ kind: 'activity', repeatCount: 2, message: { id: 'sync-2' } });
    expect(timeline.slice(1).map((item) => item.kind === 'activity' && item.repeatCount)).toEqual([1, 1]);
  });

  it('shows only an active provisional response while durable rows overlap it', () => {
    const timeline = projectChatTimeline([
      message({ id: 'live', agentId: 'mario', invocationId: 'inv-live', content: '实时内容', isStreaming: true }),
      message({ id: 'durable', agentId: 'mario', invocationId: 'inv-live', content: '持久内容' }),
    ]);

    expect(timeline[0].kind === 'response' && timeline[0].messages.map((item) => item.id)).toEqual(['live']);
  });
});

describe('ChatMessageItem invocation surface', () => {
  it('retains acknowledgements for every message in the visible hydration window', () => {
    const visibleMessages = Array.from({ length: 60 }, (_, index) => message({
      id: `human-${index}`,
      agentId: 'human',
      content: `消息 ${index}`,
    }));
    useTaskHubStore.setState({
      chatMessagesByConversation: { 'conversation-1': visibleMessages },
      dispatchReceiptsByConversation: {},
    });

    for (let index = 0; index < visibleMessages.length; index += 1) {
      useTaskHubStore.getState().recordDispatchReceipt({
        projectId: 'conversation-1',
        receiptId: `env-${index}:acknowledged`,
        conversationId: 'conversation-1',
        sourceMessageId: `human-${index}`,
        targetAgentId: 'mario',
        phase: 'acknowledged',
        createdAt: `2026-07-30T02:${String(index).padStart(2, '0')}:00.000Z`,
      });
    }

    expect(useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1']).toHaveLength(60);
    expect(useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1'][0].sourceMessageId)
      .toBe('human-0');

    useTaskHubStore.getState().recordDispatchReceipt({
      projectId: 'conversation-1',
      receiptId: 'env-human-0-newer:acknowledged',
      conversationId: 'conversation-1',
      sourceMessageId: 'human-0',
      targetAgentId: 'mario',
      phase: 'acknowledged',
      createdAt: '2026-07-30T03:00:00.000Z',
    });
    const retained = useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1'];
    expect(retained).toHaveLength(60);
    expect(retained.some((receipt) => receipt.receiptId === 'env-human-0-newer:acknowledged')).toBe(true);

    const tiedAt = '2026-07-30T04:00:00.000Z';
    useTaskHubStore.getState().recordDispatchReceipt({
      projectId: 'conversation-1', receiptId: 'env-tied:sent', conversationId: 'conversation-1',
      sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'sent', createdAt: tiedAt,
    });
    useTaskHubStore.getState().recordDispatchReceipt({
      projectId: 'conversation-1', receiptId: 'env-tied:acknowledged', conversationId: 'conversation-1',
      sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'acknowledged', createdAt: tiedAt,
    });
    expect(useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1'])
      .toContainEqual(expect.objectContaining({ receiptId: 'env-tied:acknowledged', phase: 'acknowledged' }));
    expect(useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1'])
      .toContainEqual(expect.objectContaining({ receiptId: 'env-tied:sent', phase: 'sent' }));

    useTaskHubStore.getState().recordDispatchReceipt({
      projectId: 'conversation-1', receiptId: 'env-newer-progress:sent', conversationId: 'conversation-1',
      sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'sent',
      createdAt: '2026-07-30T05:00:00.000Z',
    });
    const withNewerProgress = useTaskHubStore.getState().dispatchReceiptsByConversation['conversation-1'];
    expect(withNewerProgress).toContainEqual(expect.objectContaining({ receiptId: 'env-tied:acknowledged' }));
    expect(withNewerProgress).toContainEqual(expect.objectContaining({ receiptId: 'env-newer-progress:sent' }));

    render(<ChatMessageItem message={message({ id: 'human-1', agentId: 'human', content: '请继续处理' })} />);
    expect(screen.getByLabelText('Mario 已收到')).toBeDefined();
  });

  it('shows one Agent reaction only after an authoritative acknowledgement for this message', () => {
    useTaskHubStore.setState({
      dispatchReceiptsByConversation: {
        'conversation-1': [
          {
            projectId: 'conversation-1', receiptId: 'env-1:sent', conversationId: 'conversation-1',
            sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'sent', createdAt: '2026-07-30T02:30:01.000Z',
          },
          {
            projectId: 'conversation-1', receiptId: 'env-1:acknowledged', conversationId: 'conversation-1',
            sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'acknowledged', createdAt: '2026-07-30T02:30:02.000Z',
          },
          {
            projectId: 'conversation-1', receiptId: 'env-2:acknowledged', conversationId: 'conversation-1',
            sourceMessageId: 'another-message', targetAgentId: 'peach', phase: 'acknowledged', createdAt: '2026-07-30T02:30:03.000Z',
          },
        ],
      },
    });

    render(<ChatMessageItem message={message({ id: 'human-1', agentId: 'human', content: '@mario 请处理' })} />);

    expect(screen.getByTestId('agent-acknowledgements').children).toHaveLength(1);
    expect(screen.getByLabelText('Mario 已收到').textContent).toBe('⭐');
    expect(screen.queryByLabelText('Peach 已收到')).toBeNull();
  });

  it('does not treat requested or sent receipts as Agent acknowledgement', () => {
    useTaskHubStore.setState({
      dispatchReceiptsByConversation: {
        'conversation-1': [{
          projectId: 'conversation-1', receiptId: 'env-1:sent', conversationId: 'conversation-1',
          sourceMessageId: 'human-1', targetAgentId: 'mario', phase: 'sent', createdAt: '2026-07-30T02:30:01.000Z',
        }],
      },
    });

    render(<ChatMessageItem message={message({ id: 'human-1', agentId: 'human', content: '请处理' })} />);
    expect(screen.queryByTestId('agent-acknowledgements')).toBeNull();
  });

  it('shows thinking and the final answer while reducing tool calls to one operation receipt', () => {
    const segments = [
      message({ id: 'thinking', agentId: 'peach', invocationId: 'inv-review', contentType: 'thinking', content: '先核对改动，再确认测试证据。' }),
      message({ id: 'write', agentId: 'peach', invocationId: 'inv-review', content: '', toolEvents: [{
        id: 'tool-write', type: 'tool_use', label: 'Write', timestamp: '2026-07-30T02:30:01.000Z',
      }] }),
      message({ id: 'read', agentId: 'peach', invocationId: 'inv-review', content: '', toolEvents: [{
        id: 'tool-read', type: 'tool_use', label: 'Read', timestamp: '2026-07-30T02:30:02.000Z',
      }] }),
      message({ id: 'final', agentId: 'peach', invocationId: 'inv-review', content: '评审完成，证据已确认。' }),
    ];

    render(<ChatMessageItem message={segments[0]} responseSegments={segments} />);

    expect(screen.getByText('评审完成，证据已确认。')).toBeDefined();
    expect(screen.getByText('思考过程')).toBeDefined();
    expect(screen.getAllByText('先核对改动，再确认测试证据。')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /已处理 2 个操作.*查看运行详情/ })).toBeDefined();
    expect(screen.queryByText('Write')).toBeNull();
    expect(screen.queryByText('Read')).toBeNull();
  });

  it('collapses long agent prose without hiding the full response permanently', () => {
    const longAnswer = [
      '结论：功能已经完成。',
      '证据：相关测试全部通过。',
      ...Array.from({ length: 20 }, (_, index) => `过程细节 ${index + 1}：这里是仅在展开后阅读的说明。`),
    ].join('\n\n');

    render(<ChatMessageItem message={message({
      id: 'long-final',
      agentId: 'mario',
      invocationId: 'inv-long',
      content: longAnswer,
    })} />);

    expect(screen.getByText('结论：功能已经完成。')).toBeDefined();
    expect(screen.getByTestId('agent-narrative-content').className).toContain('max-h-44');
    fireEvent.click(screen.getByRole('button', { name: '展开完整回复' }));
    expect(screen.getByText(/过程细节 20/)).toBeDefined();
    expect(screen.getByTestId('agent-narrative-content').className).not.toContain('max-h-44');
    expect(screen.getByRole('button', { name: '收起完整回复' }).getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    ['single paragraph', '这是一个没有空行的超长单段。'.repeat(100)],
    ['fenced code', `\`\`\`ts\n${'const value = 1;\n'.repeat(60)}\`\`\``],
  ])('visually bounds long %s content until the user expands it', (_shape, content) => {
    render(<ChatMessageItem message={message({
      id: `long-${_shape}`,
      agentId: 'mario',
      invocationId: `inv-${_shape}`,
      content,
    })} />);

    const narrative = screen.getByTestId('agent-narrative-content');
    expect(narrative.className).toContain('overflow-hidden');
    fireEvent.click(screen.getByRole('button', { name: '展开完整回复' }));
    expect(narrative.className).not.toContain('overflow-hidden');
  });
});

describe('ChatActivityNotice fact surface', () => {
  it('renders accepted command events as facts instead of observation pills', () => {
    render(<ChatActivityNotice message={message({
      id: 'fact-work', agentId: 'system', content: '工作“事件投影”已创建',
      referencedTaskId: 'work-1', metadata: { factType: 'work.created', commandId: 'cmd-1' },
    })} />);
    expect(screen.getByTestId('command-fact-card')).toBeDefined();
    expect(screen.getByText('工作已登记')).toBeDefined();
    expect(screen.getByRole('button', { name: '打开工作' })).toBeDefined();
  });
});
