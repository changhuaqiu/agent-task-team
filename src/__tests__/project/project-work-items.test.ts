import { describe, expect, it } from 'vitest';
import { projectWorkItems } from '@/lib/project-work-items';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

const project: WorkspaceProject = {
  id: 'project-1', name: 'Project', rootPath: 'C:/project', workspaceConversationId: 'workspace-1',
  createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
};

function conversation(input: Partial<Conversation> & Pick<Conversation, 'id'>): Conversation {
  return {
    title: input.id, goal: '', status: 'active', priority: 'p2', projectPath: project.rootPath,
    breakdownStatus: 'none', createdAt: '2026-08-31T00:00:00.000Z', updatedAt: '2026-08-31T00:00:00.000Z',
    ...input,
  };
}

function task(id: string, conversationId: string, createdAt: string): Task {
  return {
    id, conversationId, phaseId: '', title: id, category: 'issue', description: '', status: 'ready', agentId: '',
    dependencies: [], artifacts: [], createdAt, updatedAt: createdAt, revision: 1,
  };
}

describe('projectWorkItems', () => {
  it('groups a new workstream under one root and preserves child Tasks', () => {
    const conversations = [
      conversation({ id: 'workspace-1', projectId: project.id, workspaceKind: 'project_workspace' }),
      conversation({ id: 'workstream-1', projectId: project.id, workspaceKind: 'workstream', rootTaskId: 'root' }),
    ];
    const items = projectWorkItems(project, conversations, [
      task('child', 'workstream-1', '2026-08-31T00:00:00.000Z'),
      task('root', 'workstream-1', '2026-08-31T00:01:00.000Z'),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'root', conversationId: 'workstream-1', legacy: false });
    expect(items[0].childTasks.map((item) => item.id)).toEqual(['child']);
  });

  it('keeps every Project-workspace Task discoverable as a legacy work item', () => {
    const items = projectWorkItems(project, [
      conversation({ id: 'workspace-1', projectId: project.id, workspaceKind: 'project_workspace' }),
    ], [
      task('legacy-a', 'workspace-1', '2026-08-31T00:00:00.000Z'),
      task('legacy-b', 'workspace-1', '2026-08-31T00:01:00.000Z'),
    ]);
    expect(items.map((item) => item.id)).toEqual(['legacy-b', 'legacy-a']);
    expect(items.every((item) => item.legacy)).toBe(true);
  });

  it('does not leak another Project workstream into the projection', () => {
    const items = projectWorkItems(project, [
      conversation({ id: 'workspace-1', projectId: project.id, workspaceKind: 'project_workspace' }),
      conversation({ id: 'other-work', projectId: 'other', workspaceKind: 'workstream' }),
    ], [task('other-task', 'other-work', '2026-08-31T00:00:00.000Z')]);
    expect(items).toEqual([]);
  });

  it('keeps an accepted workstream visible before planning creates its root task', () => {
    const pending = conversation({
      id: 'workstream-pending',
      projectId: project.id,
      workspaceKind: 'workstream',
      title: '#42 Fix login',
      goal: 'Fix login from GitHub Issue #42',
    });

    expect(projectWorkItems(project, [
      conversation({ id: 'workspace-1', projectId: project.id, workspaceKind: 'project_workspace' }),
      pending,
    ], [])).toMatchObject([{
      id: 'workstream-pending',
      conversationId: 'workstream-pending',
      title: '#42 Fix login',
      status: 'proposed',
      tasks: [],
      sourceLabel: '等待任务规划',
    }]);
  });
});

describe('audit fixture: 4 work items, 13 execution records', () => {
  it('counts root work, not execution records, and excludes ready from active', async () => {
    const { projectWorkSummary, resolveProjectWorkItem } = await import('@/lib/project-work-items');
    const scopes = [
      conversation({ id: 'workspace-1', projectId: project.id, workspaceKind: 'project_workspace' }),
      conversation({ id: 'new', projectId: project.id, workspaceKind: 'workstream', rootTaskId: 'root' }),
      conversation({ id: 'pending', projectId: project.id, workspaceKind: 'workstream' }),
    ];
    const tasks = [
      task('legacy-a', 'workspace-1', '2026-09-06T00:00:00Z'),
      { ...task('legacy-b', 'workspace-1', '2026-09-06T00:00:00Z'), status: 'done' as const },
      { ...task('root', 'new', '2026-09-06T00:00:00Z'), status: 'in_progress' as const },
      ...Array.from({ length: 10 }, (_, i) => task('child-' + i, 'new', '2026-09-06T00:00:00Z')),
    ];
    const items = projectWorkItems(project, scopes, tasks);
    expect(tasks).toHaveLength(13);
    expect(projectWorkSummary(items)).toMatchObject({ total: 4, active: 1, done: 1, open: 3 });
    expect(resolveProjectWorkItem(items, { conversationId: 'new', taskId: 'child-4' })?.id).toBe('root');
    expect(resolveProjectWorkItem(items, { conversationId: 'workspace-1', taskId: 'child-4' })).toBeUndefined();
  });
});
