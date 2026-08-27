// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectAddDialog } from '@/components/project/ProjectAddDialog';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';

vi.mock('@/components/ui/FolderPicker', () => ({
  FolderPicker: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <label>
      项目目录
      <input aria-label="项目目录" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));

const alpha: WorkspaceProject = {
  id: 'alpha',
  name: 'Alpha',
  rootPath: 'C:/projects/alpha',
  workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
};

afterEach(() => {
  cleanup();
  useTaskHubStore.setState({ projects: [] });
});

describe('ProjectAddDialog', () => {
  it('browses reusable projects before showing the create form', () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const addProject = vi.fn();
    useTaskHubStore.setState({ projects: [alpha], addProject });

    render(<ProjectAddDialog open onClose={onClose} onCreated={onCreated} />);

    expect(screen.getByRole('heading', { name: '添加或打开项目' })).toBeDefined();
    expect(screen.queryByLabelText('项目目录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(onCreated).toHaveBeenCalledWith(alpha);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(addProject).not.toHaveBeenCalled();
  });

  it('carries an unmatched search into the scoped create form', () => {
    useTaskHubStore.setState({ projects: [alpha] });
    render(<ProjectAddDialog open onClose={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('搜索项目名称或目录'), { target: { value: 'Desktop Shell' } });
    fireEvent.click(screen.getByRole('button', { name: /连接“Desktop Shell”/ }));

    expect(screen.getByRole('heading', { name: '连接新项目' })).toBeDefined();
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe('Desktop Shell');
    expect(screen.getByLabelText('项目目录')).toBeDefined();
  });

  it('waits for the authoritative create result before opening the project', async () => {
    const created: WorkspaceProject = { ...alpha, id: 'desktop', name: 'Desktop' };
    const addProject = vi.fn().mockResolvedValue(created);
    const onClose = vi.fn();
    const onCreated = vi.fn();
    useTaskHubStore.setState({ projects: [], addProject });
    render(<ProjectAddDialog open onClose={onClose} onCreated={onCreated} />);

    fireEvent.click(screen.getByRole('button', { name: /连接新项目选择本地目录/ }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'Desktop' } });
    fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: 'C:/projects/desktop' } });
    fireEvent.click(screen.getByRole('button', { name: '连接项目' }));

    await waitFor(() => expect(addProject).toHaveBeenCalledWith({ name: 'Desktop', rootPath: 'C:/projects/desktop' }));
    expect(onCreated).toHaveBeenCalledWith(created);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps rejected input in place and protects a dirty draft from closing', async () => {
    const addProject = vi.fn().mockRejectedValue(new Error('目录已经属于其他项目'));
    const onClose = vi.fn();
    useTaskHubStore.setState({ projects: [], addProject });
    render(<ProjectAddDialog open onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /连接新项目选择本地目录/ }));
    fireEvent.change(screen.getByLabelText('项目名称'), { target: { value: 'Desktop' } });
    fireEvent.change(screen.getByLabelText('项目目录'), { target: { value: 'C:/projects/desktop' } });
    fireEvent.click(screen.getByRole('button', { name: '连接项目' }));

    expect((await screen.findByRole('alert')).textContent).toContain('目录已经属于其他项目');
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe('Desktop');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('alertdialog', { name: '放弃项目草稿' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }));
    expect((screen.getByLabelText('项目名称') as HTMLInputElement).value).toBe('Desktop');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '放弃改动' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
