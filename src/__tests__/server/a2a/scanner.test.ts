// src/__tests__/server/a2a/scanner.test.ts
import { describe, it, expect } from 'vitest';
import { scanMentions } from '@/server/a2a/scanner';
import type { AgentMentionConfig } from '@/server/a2a/types';

const AGENTS: AgentMentionConfig[] = [
  { id: 'mario', mentionPatterns: ['@mario', '@Mario', '@马里奥'] },
  { id: 'luigi', mentionPatterns: ['@luigi', '@Luigi', '@路易吉'] },
  { id: 'toad', mentionPatterns: ['@toad', '@Toad'] },
];

describe('scanMentions', () => {
  it('extracts a single @mention at line start', () => {
    const text = '我完成了设计\n@luigi 请开始实现\n谢谢';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('skips @mentions inside fenced code blocks', () => {
    const text = '看这段代码\n```\n@luigi 不应该匹配\n```\n@luigi 这个才匹配';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
  });

  it('skips @mentions inline (not at line start)', () => {
    const text = '我告诉 @luigi 去做这件事';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });

  it('filters out self-mentions', () => {
    const text = '@mario 自己检查一下\n@luigi 开始工作';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('returns max 2 targets', () => {
    const text = '@luigi 做前端\n@toad 做测试\n@mario 不算自己';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('uses longest match to prevent prefix collision', () => {
    const agents: AgentMentionConfig[] = [
      { id: 'luigi', mentionPatterns: ['@luigi'] },
      { id: 'luigi-jr', mentionPatterns: ['@luigi-jr'] },
    ];
    const text = '@luigi-jr 开始';
    const result = scanMentions(text, agents, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi-jr');
  });

  it('matches CJK mention patterns', () => {
    const text = '@路易吉 开始吧';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('returns empty for no mentions', () => {
    const text = '没有 mention 的普通文本';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });
});
