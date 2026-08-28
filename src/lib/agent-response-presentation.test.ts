import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/store/types';
import { projectAgentResponse } from './agent-response-presentation';

function message(input: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'content'>): ChatMessage {
  return {
    agentId: 'mario',
    timestamp: '2026-08-28T01:00:00.000Z',
    ...input,
  };
}

describe('projectAgentResponse', () => {
  it('keeps durable thinking outside the final answer and summarizes operations', () => {
    const presentation = projectAgentResponse([
      message({ id: 'thinking', contentType: 'thinking', content: '先检查任务事实。' }),
      message({ id: 'progress', content: '正在核对实现。' }),
      message({ id: 'tool', contentType: 'tool_use', content: '', toolEvents: [
        { id: 'use', type: 'tool_use', label: 'Read', timestamp: '2026-08-28T01:00:01.000Z' },
        { id: 'result', type: 'tool_result', label: 'Read', timestamp: '2026-08-28T01:00:02.000Z' },
      ] }),
      message({ id: 'failed-tool', contentType: 'tool_result', content: '', toolEvents: [
        { id: 'error', type: 'error', label: 'Shell', timestamp: '2026-08-28T01:00:03.000Z' },
      ] }),
      message({ id: 'final', content: '实现已经完成。' }),
    ]);

    expect(presentation.thinkingText).toBe('先检查任务事实。');
    expect(presentation.finalText).toBe('实现已经完成。');
    expect(presentation.intermediateSegments.map((segment) => segment.id)).toEqual(['progress']);
    expect(presentation.operation).toEqual({
      eventCount: 3,
      operationCount: 1,
      errorCount: 1,
      isActive: false,
    });
  });

  it('projects live reasoning and answer from one provisional response', () => {
    const presentation = projectAgentResponse([
      message({
        id: 'live',
        content: '这是最终答复。',
        thinking: '正在分析依赖关系。',
        isStreaming: true,
        toolEvents: [{ id: 'error', type: 'error', label: '失败', timestamp: '2026-08-28T01:00:01.000Z' }],
      }),
    ]);

    expect(presentation.thinkingText).toBe('正在分析依赖关系。');
    expect(presentation.finalText).toBe('这是最终答复。');
    expect(presentation.operation).toMatchObject({ errorCount: 1, isActive: true });
  });
});
