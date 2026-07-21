import { describe, expect, it } from 'vitest';
import { buildUserMessageLayer } from './userMessageLayer';

describe('buildUserMessageLayer', () => {
  it('strips agent mentions and trims the message', () => {
    expect(buildUserMessageLayer('@mario 请帮我规划任务')).toBe('请帮我规划任务');
    expect(buildUserMessageLayer('  hello world  ')).toBe('hello world');
    expect(buildUserMessageLayer('@luigi @toad do something')).toBe('do something');
  });

  it('uses the readiness prompt when no message remains', () => {
    expect(buildUserMessageLayer('')).toBe('你好，请就绪并等待指令。');
    expect(buildUserMessageLayer('@mario')).toBe('你好，请就绪并等待指令。');
    expect(buildUserMessageLayer('   ')).toBe('你好，请就绪并等待指令。');
  });
});
