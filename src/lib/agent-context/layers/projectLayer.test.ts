import { describe, it, expect } from 'vitest';
import { buildProjectLayer } from './projectLayer';

describe('buildProjectLayer', () => {
  it('应该展示项目 ID', () => {
    const result = buildProjectLayer({
      id: 'conv-123',
      name: 'Test Project',
      path: '/path/to/project',
    });
    
    expect(result).toContain('项目 ID：conv-123');
    expect(result).toContain('项目：Test Project');
    expect(result).toContain('工作目录：/path/to/project');
  });

  it('应该处理空 name 或 path', () => {
    const result = buildProjectLayer({
      id: 'conv-123',
      name: '',
      path: '',
    });
    
    expect(result).toContain('项目 ID：conv-123');
  });
});