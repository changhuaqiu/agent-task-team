import { describe, expect, it } from 'vitest';
import {
  analyzeAgentMentionRouting,
  findActiveAgentMention,
} from './agent-mention-routing';

const candidates = [
  { agentId: 'mario', handles: ['Mario', '协调者'] },
  { agentId: 'luigi', handles: ['Luigi', '实现者'] },
  { agentId: 'peach', handles: ['Peach', '评审者'] },
  { agentId: 'dk', handles: ['DK', '架构师'] },
];

describe('agent mention routing', () => {
  it('routes unique line-start handles and preserves their order', () => {
    expect(analyzeAgentMentionRouting('@mario @实现者 请并行处理', candidates)).toMatchObject({
      hasRoutingMentions: true,
      targetAgentIds: ['mario', 'luigi'],
      unknownHandles: [],
      overflowHandles: [],
    });
  });

  it('supports Markdown quote and list prefixes on separate routing lines', () => {
    expect(analyzeAgentMentionRouting('> @luigi 开始\n2. @peach 复核', candidates).targetAgentIds)
      .toEqual(['luigi', 'peach']);
  });

  it('does not turn inline mentions, email addresses, or fenced examples into work', () => {
    const content = '请告知 @luigi，邮件 a@mario.dev\n```text\n@mario 示例\n```';
    expect(analyzeAgentMentionRouting(content, candidates)).toMatchObject({
      hasRoutingMentions: false,
      targetAgentIds: [],
    });
  });

  it('keeps mismatched and quoted Markdown fences closed to routing', () => {
    const content = [
      '```js',
      '~~~',
      '@mario still code',
      '```',
      '> ```text',
      '> @luigi quoted code',
      '> ```',
    ].join('\n');
    expect(analyzeAgentMentionRouting(content, candidates).targetAgentIds).toEqual([]);
  });

  it('normalizes Unicode marks and does not prefix-match dotted handles', () => {
    const result = analyzeAgentMentionRouting('@Cafe\u0301 @reviewer.v2 @reviewer/v3', [
      { agentId: 'cafe', handles: ['Café'] },
      { agentId: 'reviewer', handles: ['reviewer'] },
    ]);
    expect(result.targetAgentIds).toEqual(['cafe']);
    expect(result.unknownHandles).toEqual(['reviewer.v2', 'reviewer/v3']);
  });

  it('matches the longest known alias, including display names with spaces', () => {
    const result = analyzeAgentMentionRouting('@Member Planner @reviewer/v2 go', [
      { agentId: 'planner', handles: ['Member', 'Member Planner'] },
      { agentId: 'reviewer-v2', handles: ['reviewer/v2'] },
    ]);
    expect(result.targetAgentIds).toEqual(['planner', 'reviewer-v2']);
  });

  it('keeps parsing after Unicode case folding expands a handle', () => {
    const result = analyzeAgentMentionRouting('@İ @mario work', [
      { agentId: 'istanbul', handles: ['İ'] },
      { agentId: 'mario', handles: ['mario'] },
    ]);
    expect(result.targetAgentIds).toEqual(['istanbul', 'mario']);
  });

  it('deduplicates targets and reports unknown, ambiguous, and overflow handles', () => {
    const result = analyzeAgentMentionRouting(
      '@mario @Mario @ghost @shared @luigi @peach @dk 做事',
      [
        ...candidates,
        { agentId: 'one', handles: ['shared'] },
        { agentId: 'two', handles: ['shared'] },
      ],
    );
    expect(result.targetAgentIds).toEqual(['mario', 'luigi', 'peach']);
    expect(result.unknownHandles).toEqual(['ghost']);
    expect(result.ambiguousHandles).toEqual(['shared']);
    expect(result.overflowHandles).toEqual(['dk']);
  });

  it('prefers a stable agent id over a colliding display alias', () => {
    const result = analyzeAgentMentionRouting('@mario 处理', [
      ...candidates,
      { agentId: 'other', handles: ['mario'] },
    ]);
    expect(result.targetAgentIds).toEqual(['mario']);
  });
});

describe('active mention editor', () => {
  it('opens only for the current line routing prefix and supports multiple targets', () => {
    expect(findActiveAgentMention('@mario @lu', 10)).toEqual({
      query: 'lu',
      start: 7,
      end: 10,
    });
    expect(findActiveAgentMention('说明 @lu', 6)).toBeNull();
    expect(findActiveAgentMention('> @架构', 5)).toEqual({
      query: '架构',
      start: 2,
      end: 5,
    });
    expect(findActiveAgentMention('```text\n@mario', 14)).toBeNull();
    expect(findActiveAgentMention('> ```text\n> @mario', 18)).toBeNull();
  });
});
