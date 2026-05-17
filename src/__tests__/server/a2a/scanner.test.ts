// src/__tests__/server/a2a/scanner.test.ts
import { describe, it, expect } from 'vitest';
import { scanMentions, extractMentionContent, findUnresolvedMentionTokens } from '@/server/a2a/scanner';
import type { AgentMentionConfig } from '@/server/a2a/types-v2';

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

  it('matches @mentions inline (not just line start)', () => {
    const text = '这个任务交给 @luigi 处理';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('does not match @mention mid-word', () => {
    const text = 'email is foo@luigi.com';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });

  it('filters out self-mentions', () => {
    const text = '@mario 自己检查一下\n@luigi 开始工作';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('luigi');
  });

  it('bounds mention scan results defensively', () => {
    const text = '@luigi 做前端\n@toad 做测试\n@mario 不算自己';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result.length).toBeLessThanOrEqual(12);
    expect(result.map((target) => target.agentId)).toEqual(['luigi', 'toad']);
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

  it('returns repeated mentions so pass intent can choose the actionable one', () => {
    const text = '我参考了 @luigi 的旧方案。\n@luigi 请实现新的任务图加载兜底逻辑';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(2);
    expect(result.every((target) => target.agentId === 'luigi')).toBe(true);
    expect(result[1].position).toBeGreaterThan(result[0].position);
  });

  it('returns empty for no mentions', () => {
    const text = '没有 mention 的普通文本';
    const result = scanMentions(text, AGENTS, 'mario');
    expect(result).toHaveLength(0);
  });
});

describe('extractMentionContent', () => {
  it('extracts content after @mention', () => {
    const text = '状态广播：BUG-7 done\n\n@luigi 请开始写文档\n\n其他内容';
    const targets = scanMentions(text, AGENTS, 'mario');
    const content = extractMentionContent(text, targets[0]);
    expect(content).toContain('请开始写文档');
    expect(content).not.toContain('BUG-7 done');
  });

  it('falls back to full text when mention content is too short', () => {
    const text = '内容 @luigi';
    const targets = scanMentions(text, AGENTS, 'mario');
    const content = extractMentionContent(text, targets[0]);
    // No content after mention, falls back to full text
    expect(content).toBe(text);
  });

  it('stops at next @mention', () => {
    const text = '@luigi 请实现前端的登录组件和注册页面 @toad 写测试';
    const targets = scanMentions(text, AGENTS, 'mario');
    const content = extractMentionContent(text, targets[0]);
    expect(content).toContain('请实现前端的登录组件和注册页面');
    expect(content).not.toContain('@toad');
  });
});

describe('findUnresolvedMentionTokens', () => {
  it('returns @mentions that are not in the runtime roster', () => {
    const text = '请 @dk 做架构评审，然后 @luigi 实现';
    const result = findUnresolvedMentionTokens(text, AGENTS, 'mario');
    expect(result).toEqual(['@dk']);
  });

  it('ignores generic mention placeholders in explanatory text', () => {
    const text = 'A2A 通过 @mention token 触发，但这里的 @agent 只是文档占位符。';
    const result = findUnresolvedMentionTokens(text, AGENTS, 'mario');
    expect(result).toEqual([]);
  });

  it('ignores code blocks and self mentions', () => {
    const text = '@mario 自己别转交\n```txt\n@dk 不应该匹配\n```';
    const result = findUnresolvedMentionTokens(text, AGENTS, 'mario');
    expect(result).toEqual([]);
  });
});
