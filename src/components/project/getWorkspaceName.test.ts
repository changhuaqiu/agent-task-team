import { describe, it, expect } from 'vitest';
import { getWorkspaceName, getWorkspaceFullPath } from './getWorkspaceName';

const makeConversation = (projectPath?: string) => ({
  id: 'test',
  title: 'Test',
  goal: 'Test goal',
  status: 'active' as const,
  priority: 'p1' as const,
  projectPath: projectPath ?? '',
  breakdownStatus: 'none' as const,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

describe('getWorkspaceName', () => {
  it('returns fallback when no conversations', () => {
    expect(getWorkspaceName([])).toBe('工作区');
  });

  it('returns fallback when no conversation has projectPath', () => {
    expect(getWorkspaceName([makeConversation('')])).toBe('工作区');
  });

  it('returns last directory segment from projectPath', () => {
    expect(getWorkspaceName([makeConversation('/Users/dev/my-project')])).toBe('my-project');
  });

  it('handles trailing slash', () => {
    expect(getWorkspaceName([makeConversation('/Users/dev/my-project/')])).toBe('my-project');
  });

  it('uses first conversation with a path', () => {
    const convs = [makeConversation(''), makeConversation('/home/app/real-project')];
    expect(getWorkspaceName(convs)).toBe('real-project');
  });

  it('returns bare segment when path has no slashes', () => {
    expect(getWorkspaceName([makeConversation('my-app')])).toBe('my-app');
  });
});

describe('getWorkspaceFullPath', () => {
  it('returns null when no conversations', () => {
    expect(getWorkspaceFullPath([])).toBeNull();
  });

  it('returns the path from first conversation that has one', () => {
    expect(getWorkspaceFullPath([makeConversation('/Users/dev/project')])).toBe('/Users/dev/project');
  });

  it('returns null when no conversation has a path', () => {
    expect(getWorkspaceFullPath([makeConversation('')])).toBeNull();
  });
});
