import { describe, expect, it } from 'vitest';
import { buildHandoffPacketDraft } from '@/server/a2a/handoff-packet';

describe('buildHandoffPacketDraft', () => {
  it('extracts summary, decisions, evidence, and open questions', () => {
    const packet = buildHandoffPacketDraft({
      fromHolderId: 'mario',
      toAgentId: 'luigi',
      intent: 'implement',
      content: [
        '架构设计完成，决策：使用 task graph API 作为事实源。',
        '证据见 src/pages/api/task-graph.ts 和 TASK-001。',
        '风险：离线兜底是否需要缓存？',
        '@luigi 请实现任务图加载失败时的本地视图兜底。',
      ].join('\n'),
      sourceMessageIds: ['msg-1'],
    });

    expect(packet.possessionSummary).toContain('架构设计完成');
    expect(packet.relevantDecisions).toEqual(expect.arrayContaining([
      expect.stringContaining('使用 task graph API'),
    ]));
    expect(packet.evidenceRefs).toEqual(expect.arrayContaining([
      { label: 'src/pages/api/task-graph.ts', path: 'src/pages/api/task-graph.ts' },
      { label: 'TASK-001', taskId: 'TASK-001' },
    ]));
    expect(packet.openQuestions).toEqual([
      expect.stringContaining('离线兜底'),
    ]);
    expect(packet.requestedAction).toContain('请实现任务图加载失败');
  });
});
