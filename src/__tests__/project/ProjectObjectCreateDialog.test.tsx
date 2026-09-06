// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectObjectCreateDialog } from '@/components/project/ProjectObjectCreateDialog';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project: WorkspaceProject = {
  id: 'alpha', name: 'Alpha', rootPath: 'C:/projects/alpha', workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};

const task: Task = {
  id: 'task-1', conversationId: 'workspace-alpha', phaseId: '', title: '实现创建逻辑', description: '',
  status: 'in_progress', agentId: 'mario', dependencies: [], artifacts: [], revision: 1,
  createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
};

describe('ProjectObjectCreateDialog', () => {
  it('creates work in the already selected project scope without asking for the project again', async () => {
    const loadFromServer = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'applied', result: { task: { id: 'work-1' } } }) });
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      agentRoster: [{ id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', isOnline: true, accountIds: [], instructions: '', skillIds: [], canModifyCode: true, canReview: false }],
      loadFromServer,
    });
    const onClose = vi.fn();
    render(<ProjectObjectCreateDialog kind="work" project={project} tasks={[]} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('要完成什么？'), { target: { value: '实现统一创建' } });
    fireEvent.click(screen.getByRole('button', { name: '创建工作项' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/commands', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ name: 'work.create', projectId: project.id, input: { title: '实现统一创建', category: 'issue' } });
    expect(loadFromServer).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('负责人')).toBeNull();
    expect(screen.queryByLabelText(/项目/)).toBeNull();
    expect(onClose).toHaveBeenCalled();
  });

  it('creates an independent review for a repository branch pair', async () => {
    const review = {
      id: 'review-1', projectId: project.id, repositoryRoot: project.rootPath,
      baseRef: 'main', compareRef: 'feature/review', title: '统一评审', description: '',
      status: 'open', revision: 1, createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z', reference: 'ath://review?project=alpha&id=review-1',
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'applied', result: { review } }) });
    vi.stubGlobal('fetch', fetchMock);
    const onCreated = vi.fn();
    render(<ProjectObjectCreateDialog kind="review" project={project} tasks={[task]} onClose={vi.fn()} />);
    cleanup();
    render(<ProjectObjectCreateDialog kind="review" project={project} tasks={[task]} onClose={vi.fn()} onReviewCreated={onCreated} />);
    fireEvent.change(screen.getByPlaceholderText('feature/branch'), { target: { value: 'feature/review' } });
    fireEvent.change(screen.getByPlaceholderText('这次评审要确认什么？'), { target: { value: '统一评审' } });
    fireEvent.click(screen.getByRole('button', { name: '发起评审' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/commands', expect.objectContaining({ method: 'POST' })));
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({ name: 'review.create', projectId: project.id, input: { baseRef: 'main', compareRef: 'feature/review', title: '统一评审' } });
    expect(onCreated).toHaveBeenCalledWith(review);
  });

  it('keeps the dialog open and reports a rejected work creation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ status: 'rejected', reasonCode: 'work_project_not_found' }) }));
    useTaskHubStore.setState({
      selectedConversationId: project.workspaceConversationId,
      agentRoster: [{ id: 'mario', name: 'Mario', theme: 'mario', emoji: '⭐', isOnline: true, accountIds: [], instructions: '', skillIds: [], canModifyCode: true, canReview: false }],
    });
    const onClose = vi.fn();
    render(<ProjectObjectCreateDialog kind="work" project={project} tasks={[]} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('要完成什么？'), { target: { value: '修复创建回执' } });
    fireEvent.click(screen.getByRole('button', { name: '创建工作项' }));
    expect((await screen.findByRole('alert')).textContent).toContain('创建工作失败');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('guards a dirty object draft and resumes editing without losing fields', () => {
    const onClose = vi.fn();
    render(<ProjectObjectCreateDialog kind="work" project={project} tasks={[]} onClose={onClose} />);
    const title = screen.getByPlaceholderText('要完成什么？') as HTMLInputElement;
    fireEvent.change(title, { target: { value: '保留这份草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('alertdialog', { name: '放弃工作草稿' })).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect(title.value).toBe('保留这份草稿');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃改动' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
