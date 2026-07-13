import { describe, it, expect } from 'vitest';
import {
  scopeGuard,
  hasScopeViolation,
  legacyScopeGuard,
  filterByProjectId,
} from './scopeGuard';

// New API tests (as specified in current task)
describe('scopeGuard (new API)', () => {
  it('should pass when all sources belong to the same project', () => {
    expect(() => {
      scopeGuard({
        projectId: 'proj-123',
        sources: [
          { source: 'history', projectId: 'proj-123' },
          { source: 'task', projectId: 'proj-123' },
        ],
      });
    }).not.toThrow();
  });

  it('should pass when all sources have undefined projectId', () => {
    expect(() => {
      scopeGuard({
        projectId: 'proj-123',
        sources: [
          { source: 'history', projectId: undefined },
          { source: 'task', projectId: undefined },
        ],
      });
    }).not.toThrow();
  });

  it('should pass when sources are empty', () => {
    expect(() => {
      scopeGuard({
        projectId: 'proj-123',
        sources: [],
      });
    }).not.toThrow();
  });

  it('should throw when one source has different projectId', () => {
    expect(() => {
      scopeGuard({
        projectId: 'proj-123',
        sources: [
          { source: 'history', projectId: 'proj-123' },
          { source: 'task', projectId: 'proj-456' },
        ],
      });
    }).toThrow('violations');
  });

  it('should throw with correct error type', () => {
    try {
      scopeGuard({
        projectId: 'proj-123',
        sources: [{ source: 'history', projectId: 'proj-456' }],
      });
      expect.fail('Should have thrown');
    } catch (error) {
      expect((error as any).type).toBe('mixed_project_id');
    }
  });

  it('should throw with details about violations', () => {
    try {
      scopeGuard({
        projectId: 'proj-123',
        sources: [
          { source: 'history', projectId: 'proj-123' },
          { source: 'task', projectId: 'proj-456' },
          { source: 'teamPack', projectId: 'proj-789' },
        ],
      });
      expect.fail('Should have thrown');
    } catch (error) {
      const err = error as any;
      expect(err.details.expectedProjectId).toBe('proj-123');
      expect(err.details.violation).toHaveLength(2);
    }
  });
});

describe('hasScopeViolation', () => {
  it('should return false when no violations exist', () => {
    const result = hasScopeViolation({
      projectId: 'proj-123',
      sources: [
        { source: 'history', projectId: 'proj-123' },
        { source: 'task', projectId: 'proj-123' },
      ],
    });
    expect(result).toBe(false);
  });

  it('should return true when violations exist', () => {
    const result = hasScopeViolation({
      projectId: 'proj-123',
      sources: [
        { source: 'history', projectId: 'proj-123' },
        { source: 'task', projectId: 'proj-456' },
      ],
    });
    expect(result).toBe(true);
  });

  it('should return false when sources are empty', () => {
    const result = hasScopeViolation({
      projectId: 'proj-123',
      sources: [],
    });
    expect(result).toBe(false);
  });

  it('should not throw when checking violations', () => {
    expect(() => {
      hasScopeViolation({
        projectId: 'proj-123',
        sources: [{ source: 'task', projectId: 'proj-456' }],
      });
    }).not.toThrow();
  });
});

// Legacy API tests (for backward compatibility with TASK-004)
describe('legacyScopeGuard (backward compatibility)', () => {
  it('同 conversationId 的 items 不应抛错', () => {
    const items = [{ conversationId: 'conv-001' }, { conversationId: 'conv-001' }];

    expect(() => {
      legacyScopeGuard(items, 'conv-001', 'test');
    }).not.toThrow();
  });

  it('跨 conversationId 的 items 应抛错', () => {
    const items = [{ conversationId: 'conv-001' }, { conversationId: 'conv-002' }];

    expect(() => {
      legacyScopeGuard(items, 'conv-001', 'test');
    }).toThrow('[test] 跨项目串话检测失败');
  });

  it('错误消息应包含预期的 conversationId', () => {
    const items = [{ conversationId: 'conv-001' }, { conversationId: 'conv-999' }];

    try {
      legacyScopeGuard(items, 'conv-001', 'myContext');
      expect.fail('Should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('预期 conversationId=conv-001');
      expect((e as Error).message).toContain('conversationId=conv-999');
      expect((e as Error).message).toContain('[myContext]');
    }
  });

  it('空列表不应抛错', () => {
    const items: { conversationId: string }[] = [];

    expect(() => {
      legacyScopeGuard(items, 'conv-001', 'test');
    }).not.toThrow();
  });
});

describe('filterByProjectId', () => {
  it('应该正确过滤', () => {
    const items = [
      { conversationId: 'conv-001' },
      { conversationId: 'conv-002' },
      { conversationId: 'conv-001' },
    ];

    const filtered = filterByProjectId(items, 'conv-001');

    expect(filtered).toHaveLength(2);
    expect(filtered.every(i => i.conversationId === 'conv-001')).toBe(true);
  });

  it('空列表应返回空列表', () => {
    const filtered = filterByProjectId([], 'conv-001');
    expect(filtered).toEqual([]);
  });

  it('无匹配项应返回空列表', () => {
    const items = [{ conversationId: 'conv-001' }, { conversationId: 'conv-002' }];

    const filtered = filterByProjectId(items, 'conv-999');
    expect(filtered).toEqual([]);
  });

  it('应保持原始顺序', () => {
    const items = [
      { id: 'a', conversationId: 'conv-001' },
      { id: 'b', conversationId: 'conv-002' },
      { id: 'c', conversationId: 'conv-001' },
      { id: 'd', conversationId: 'conv-001' },
    ];

    const filtered = filterByProjectId(items, 'conv-001');

    expect(filtered).toHaveLength(3);
    expect(filtered[0].id).toBe('a');
    expect(filtered[1].id).toBe('c');
    expect(filtered[2].id).toBe('d');
  });

  it('支持额外字段', () => {
    const items = [
      { id: 'msg-1', conversationId: 'conv-001', content: 'hello' },
      { id: 'msg-2', conversationId: 'conv-002', content: 'world' },
      { id: 'msg-3', conversationId: 'conv-001', content: 'foo' },
    ];

    const filtered = filterByProjectId(items, 'conv-001');

    expect(filtered).toHaveLength(2);
    expect(filtered[0].id).toBe('msg-1');
    expect(filtered[0].content).toBe('hello');
    expect(filtered[1].id).toBe('msg-3');
    expect(filtered[1].content).toBe('foo');
  });
});