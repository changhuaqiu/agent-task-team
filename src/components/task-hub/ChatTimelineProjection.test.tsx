// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ChatMessage } from '@/store/taskHubStore';
import { ChatMessageItem } from './ChatMessageItem';
import { projectChatTimeline } from './chatTimelineProjection';

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

  it('shows only an active provisional response while durable rows overlap it', () => {
    const timeline = projectChatTimeline([
      message({ id: 'live', agentId: 'mario', invocationId: 'inv-live', content: '实时内容', isStreaming: true }),
      message({ id: 'durable', agentId: 'mario', invocationId: 'inv-live', content: '持久内容' }),
    ]);

    expect(timeline[0].kind === 'response' && timeline[0].messages.map((item) => item.id)).toEqual(['live']);
  });
});

describe('ChatMessageItem invocation surface', () => {
  it('folds progress, keeps the final answer visible, and exposes tool calls in a compact trace', () => {
    const segments = [
      message({ id: 'progress', agentId: 'peach', invocationId: 'inv-review', content: '正在核对文件' }),
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
    expect(screen.getByTestId('agent-progress-details').hasAttribute('open')).toBe(false);
    const traceToggle = screen.getByRole('button', { name: /CLI Trace.*2 条事件.*2 次工具调用/ });
    expect(traceToggle).toBeDefined();
    expect(screen.getByTestId('cli-trace-preview')).toBeDefined();
    expect(screen.getByText('Write')).toBeDefined();
    expect(screen.getByText('Read')).toBeDefined();
    fireEvent.click(traceToggle);
    expect(screen.getByText('Write')).toBeDefined();
    expect(screen.getByText('Read')).toBeDefined();
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
