import { describe, it, expect } from 'vitest';
import { buildHistoryLayer } from './historyLayer';

function msg(content: string, minutesAgo: number, agentId = 'user'): any {
  return { timestamp: new Date(Date.now() - minutesAgo * 60000).toISOString(), agentId, content };
}

describe('buildHistoryLayer — GSSC Select', () => {
  it('query 相关消息优先保留，不相关的被裁（即使它们更近）', () => {
    const messages = [
      msg('python 是门好语言', 60),  // 早，但相关
      msg('今天天气不错', 5),         // 近，但不相关
      msg('吃饭了吗', 3),             // 近，但不相关
    ];
    const result = buildHistoryLayer(messages, 'agent', { query: 'python', limit: 1 });
    expect(result).toContain('python');
    expect(result).not.toContain('天气');
  });
});
