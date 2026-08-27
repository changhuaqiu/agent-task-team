// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectWorkSurface } from '@/components/project/ProjectWorkSurface';
import type { Conversation, WorkspaceProject } from '@/store/taskHubStore';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const project: WorkspaceProject = {
  id: 'alpha',
  name: 'Alpha',
  rootPath: 'C:/projects/alpha',
  workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

function task(overrides: Partial<Task> & Pick<Task, 'id' | 'title' | 'status'>): Task {
  return {
    conversationId: project.workspaceConversationId,
    phaseId: '',
    description: '',
    agentId: 'mario',
    dependencies: [],
    artifacts: [],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T01:00:00.000Z',
    revision: 1,
    ...overrides,
  };
}

function renderSurface(tasks: Task[], onCreate = vi.fn(), conversations: Conversation[] = []) {
  useTaskHubStore.setState({
    selectedConversationId: project.workspaceConversationId,
    selectedTaskId: null,
    conversations,
    tasks,
    agentRoster: [{
      id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', isOnline: true,
      accountIds: [], instructions: '', skillIds: [], canModifyCode: true, canReview: false,
    }],
  });
  render(
    <ProjectWorkSurface
      project={project}
      conversations={conversations}
      tasks={tasks}
      blockers={{}}
      onCreate={onCreate}
    />,
  );
  return onCreate;
}

describe('ProjectWorkSurface', () => {
  it('uses lifecycle groups and dense object rows instead of dashboard statistic cards', () => {
    renderSurface([
      task({ id: 'active', title: '实现任务列表', description: '让正式工作更容易扫描', status: 'in_progress', category: 'improvement' }),
      task({ id: 'review', title: '独立评审', status: 'in_review' }),
      task({ id: 'done', title: '完成设计文档', status: 'done', artifacts: [{ type: 'file', label: '设计说明' }] }),
    ]);

    expect(screen.getByRole('heading', { name: '工作' })).toBeDefined();
    expect(screen.getByText(/3 项全部/)).toBeDefined();
    expect(screen.getByRole('heading', { name: '进行中' })).toBeDefined();
    expect(screen.getByRole('heading', { name: '评审中' })).toBeDefined();
    expect(screen.getByRole('heading', { name: '已完成' })).toBeDefined();
    expect(screen.getByTestId('project-work-row-workspace-alpha-active').textContent).toContain('Mario');
    expect(screen.getByTestId('project-work-row-workspace-alpha-active').textContent).toContain('状态：进行中');
    expect(screen.queryByText('正式产物')).toBeNull();
    expect(screen.queryByText('完成口径')).toBeNull();
    expect(screen.queryByText('当前工作')).toBeNull();
  });

  it('shows formal artifact counts from the unified ledger instead of legacy task JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        artifacts: [{
          id: 'artifact-1', projectId: project.id, ref: 'workspace:report.md', label: 'report.md',
          kind: 'document', status: 'registered', updatedAt: project.updatedAt, updatedBy: 'mario',
          operations: ['register'], workId: 'active',
        }],
      }),
    }));

    renderSurface([
      task({ id: 'active', title: '统一产物工作', status: 'done', artifacts: [] }),
      task({ id: 'legacy', title: '旧产物字段', status: 'done', artifacts: [{ type: 'file', label: '旧记录' }] }),
    ]);

    await waitFor(() => expect(screen.getByTestId('project-work-row-workspace-alpha-active').textContent).toContain('1'));
    expect(screen.getByTestId('project-work-row-workspace-alpha-active').querySelector('[title="1 个正式产物"]')).not.toBeNull();
    expect(screen.getByTestId('project-work-row-workspace-alpha-legacy').querySelector('[title$="个正式产物"]')).toBeNull();
  });

  it('opens the canonical task detail scope from the whole row', () => {
    renderSurface([task({ id: 'active', title: '实现任务列表', status: 'in_progress' })]);

    useTaskHubStore.setState({
      activeRunsByAgent: {
        mario: { runId: 'run-active', conversationId: project.workspaceConversationId, startedAt: '2026-08-26T00:00:00.000Z' },
      },
      terminalLogs: { mario: ['仍在运行'] },
    });

    fireEvent.click(screen.getByTestId('project-work-row-workspace-alpha-active'));

    expect(useTaskHubStore.getState().selectedConversationId).toBe(project.workspaceConversationId);
    expect(useTaskHubStore.getState().selectedTaskId).toBe('active');
    expect(useTaskHubStore.getState().activeRunsByAgent.mario?.runId).toBe('run-active');
    expect(useTaskHubStore.getState().terminalLogs.mario).toEqual(['仍在运行']);
  });

  it('uses conversation-scoped identity when task ids collide', () => {
    const conversations: Conversation[] = [
      {
        id: 'conversation-a', title: 'A', goal: '', status: 'active', priority: 'p2',
        projectPath: project.rootPath, breakdownStatus: 'none', projectId: project.id,
        createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
      },
      {
        id: 'conversation-b', title: 'B', goal: '', status: 'active', priority: 'p2',
        projectPath: project.rootPath, breakdownStatus: 'none', projectId: project.id,
        createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z',
      },
    ];
    renderSurface([
      task({ id: 'shared', conversationId: 'conversation-a', title: '会话 A 的工作', status: 'ready' }),
      task({ id: 'shared', conversationId: 'conversation-b', title: '会话 B 的工作', status: 'ready' }),
    ], vi.fn(), conversations);

    fireEvent.click(screen.getByRole('button', { name: /会话 B 的工作/ }));

    const state = useTaskHubStore.getState();
    expect(state.selectedConversationId).toBe('conversation-b');
    expect(state.selectedTaskId).toBe('shared');
    expect(screen.getByTestId('project-work-row-conversation-a-shared').getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('project-work-row-conversation-b-shared').getAttribute('aria-current')).toBe('true');
  });

  it('keeps work scoped to the current project and offers one empty-state create action', () => {
    const onCreate = renderSurface([
      task({ id: 'foreign', title: '其他项目工作', status: 'ready', conversationId: 'workspace-bravo' }),
    ]);

    expect(screen.queryByText('其他项目工作')).toBeNull();
    expect(screen.getByText('还没有正式工作')).toBeDefined();
    expect(screen.getAllByRole('button', { name: /创建/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '创建第一项工作' }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it('is a named region and does not create a nested main landmark', () => {
    const { container } = render(
      <main>
        <ProjectWorkSurface project={project} conversations={[]} tasks={[]} blockers={{}} />
      </main>,
    );

    expect(screen.getByRole('region', { name: '项目工作' })).toBeDefined();
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
