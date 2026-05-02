import { describe, it, expect } from 'vitest';
import { parsePhaseBreakdown } from './breakdownParser';

describe('parsePhaseBreakdown', () => {
  it('parses a single phase with tasks', () => {
    const input = [
      'PHASE: 基础搭建 | 数据库和路由先行',
      'TASK: 数据库 Schema 设计 | 设计 users/orders 表 @zhongli',
      'TASK: 前端项目初始化 | 搭建 React 项目骨架 @keqing',
    ].join('\n');

    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('基础搭建');
    expect(result[0].description).toBe('数据库和路由先行');
    expect(result[0].tasks).toHaveLength(2);
    expect(result[0].tasks[0]).toEqual({
      title: '数据库 Schema 设计',
      description: '设计 users/orders 表',
      agentId: 'zhongli',
    });
    expect(result[0].tasks[1].agentId).toBe('keqing');
  });

  it('parses multiple phases', () => {
    const input = [
      'PHASE: 阶段一 | 描述一',
      'TASK: 任务 A | 描述A @jean',
      'PHASE: 阶段二 | 描述二',
      'TASK: 任务 B | 描述B @keqing',
      'TASK: 任务 C | 描述C',
    ].join('\n');

    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('阶段一');
    expect(result[0].tasks).toHaveLength(1);
    expect(result[1].title).toBe('阶段二');
    expect(result[1].tasks).toHaveLength(2);
    expect(result[1].tasks[1].agentId).toBeUndefined();
  });

  it('returns empty array when no PHASE lines found', () => {
    expect(parsePhaseBreakdown('some random text')).toEqual([]);
    expect(parsePhaseBreakdown('')).toEqual([]);
  });

  it('handles TASK without description or agentId', () => {
    const input = 'PHASE: 阶段 | 描述\nTASK: 仅标题';
    const result = parsePhaseBreakdown(input);
    expect(result[0].tasks[0]).toEqual({
      title: '仅标题',
      description: '',
      agentId: undefined,
    });
  });

  it('ignores lines before the first PHASE', () => {
    const input = [
      '这是开头的一些说明文字',
      'PHASE: 阶段 | 描述',
      'TASK: 任务 | 描述',
    ].join('\n');
    const result = parsePhaseBreakdown(input);
    expect(result).toHaveLength(1);
  });
});