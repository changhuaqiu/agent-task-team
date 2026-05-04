import { describe, it, expect } from 'vitest';
import { buildProjectStatusLayer } from './projectStatusLayer';

describe('buildProjectStatusLayer', () => {
  const agents = [
    { id: 'mario', name: 'Mario', emoji: '⭐' },
    { id: 'luigi', name: 'Luigi', emoji: '⚡' },
    { id: 'toad', name: 'Toad', emoji: '🛡️' },
  ];

  const tasks = [
    { id: 'TASK-001', title: '设计架构', agentId: 'mario', status: 'done' as const },
    { id: 'TASK-002', title: '实现登录页', agentId: 'luigi', status: 'in_progress' as const },
    { id: 'TASK-003', title: '实现用户API', agentId: 'toad', status: 'in_progress' as const },
    { id: 'TASK-004', title: '实现注册页', agentId: 'luigi', status: 'pending' as const },
    { id: 'TASK-005', title: '数据库迁移', agentId: 'toad', status: 'pending' as const },
    { id: 'TASK-006', title: '单元测试', agentId: '', status: 'pending' as const },
  ];

  it('renders project task board with summary', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('项目任务看板');
    expect(result).toContain('6 个任务');
    expect(result).toContain('1 完成');
    expect(result).toContain('2 进行中');
    expect(result).toContain('3 待处理');
  });

  it('groups tasks by agent', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('Mario');
    expect(result).toContain('Luigi');
    expect(result).toContain('TASK-002');
  });

  it('shows unassigned tasks', () => {
    const result = buildProjectStatusLayer(agents, tasks);
    expect(result).toContain('TASK-006');
  });

  it('returns empty string when no tasks', () => {
    const result = buildProjectStatusLayer(agents, []);
    expect(result).toBe('');
  });
});
