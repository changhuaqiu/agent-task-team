// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectsOverview } from '@/components/project/ProjectsOverview';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project: WorkspaceProject = { id: 'alpha', name: 'alpha', rootPath: 'C:/projects/alpha', workspaceConversationId: 'workspace-alpha', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' };
const task: Task = { id: 'task-1', conversationId: 'workspace-alpha', phaseId: '', title: 'Implement', description: '', status: 'in_review', agentId: 'builder', dependencies: [], artifacts: [], createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z', revision: 1 };

describe('ProjectsOverview', () => {
  it('summarizes project work facts and opens the project object workspace', () => {
    const onOpenProject = vi.fn();
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[task]} blockers={{}} onOpenProject={onOpenProject} />);
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeDefined();
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getByText('0 评审')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /alpha/ }));
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });

  it('starts from a project without rendering a delivery prerequisite', () => {
    render(<ProjectsOverview projects={[]} conversations={[]} tasks={[]} blockers={{}} onOpenProject={vi.fn()} />);
    expect(screen.getByText('添加第一个项目')).toBeDefined();
    expect(screen.getByText(/可直接创建工作、发起评审或与 Agent 协作/)).toBeDefined();
    expect(screen.queryByText(/交付/)).toBeNull();
  });

  it('reads the global Review lens from independent Review objects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviews: [{
        id: 'review-1', projectId: project.id, repositoryRoot: project.rootPath,
        baseRef: 'main', compareRef: 'feature/review', title: 'Independent review',
        description: '', status: 'open', revision: 1,
        createdAt: '2026-08-25T00:00:00.000Z', updatedAt: '2026-08-25T00:00:00.000Z',
        reference: 'ath://review?project=alpha&id=review-1',
      }] }),
    }));
    const onOpenProject = vi.fn();
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[]} blockers={{}} lens="reviews" onOpenProject={onOpenProject} />);

    await waitFor(() => expect(screen.getByText('Independent review')).toBeDefined());
    expect(screen.queryByText('Implement')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Independent review/ }));
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });

  it('uses independent Review objects for Review activity and needs-action filtering', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reviewCount: 1, items: [{
        conversationKey: 'review:review-activity', kind: 'review', projectId: project.id,
        projectName: project.name, subject: { type: 'review', id: 'review-activity' },
        actor: { type: 'system', id: 'review' }, title: 'Review activity fact', preview: '',
        actionState: 'needs_action', latestAt: '2026-08-25T01:00:00.000Z', unreadCount: 1,
        metadata: { status: 'changes_requested', baseRef: 'main', compareRef: 'feature/activity' },
      }] }),
    }));
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[task]} blockers={{}} lens="activity" inboxFilter="reviews" onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('Review activity fact')).toBeDefined());
    expect(screen.queryByText('Implement')).toBeNull();
  });

  it('shows a Review read failure instead of presenting an empty fact set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    const onReviewCountChange = vi.fn();
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[]} blockers={{}} lens="reviews" onOpenProject={vi.fn()} onReviewCountChange={onReviewCountChange} />);

    await waitFor(() => expect(screen.getByText('评审暂时无法读取')).toBeDefined());
    expect(screen.queryByText('没有正式评审')).toBeNull();
    expect(onReviewCountChange).toHaveBeenCalledWith(null);
  });

  it('surfaces Review read failure in Activity instead of a business empty state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[]} blockers={{}} lens="activity" onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('收件箱暂时无法读取'));
    expect(screen.queryByText('还没有工作动态')).toBeNull();
  });

  it('marks Project Review counts unknown when the Review projection cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[]} blockers={{}} lens="projects" onOpenProject={vi.fn()} />);

    await waitFor(() => expect(screen.getByText('— 评审')).toBeDefined());
    expect(screen.getByRole('alert').textContent).toContain('评审数量暂时无法读取');
  });

  it('fences an older Review response after a newer refresh fails', async () => {
    let resolveFirst: ((value: { ok: true; json: () => Promise<{ reviews: unknown[] }> }) => void) | undefined;
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('/api/inbox')) return new Promise((resolve) => { resolveFirst = resolve; });
      if (url === '/api/reviews') return Promise.resolve({ ok: false });
      return Promise.resolve({ ok: true, json: async () => ({ artifacts: [] }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const props = { projects: [project], conversations: [], tasks: [], blockers: {}, onOpenProject: vi.fn() };
    const view = render(<ProjectsOverview {...props} lens="activity" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/inbox/), expect.anything()));

    view.rerender(<ProjectsOverview {...props} lens="projects" />);
    await waitFor(() => expect(screen.getByText('— 评审')).toBeDefined());

    await act(async () => {
      resolveFirst?.({ ok: true, json: async () => ({ reviews: [] }) });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText('— 评审')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toContain('评审数量暂时无法读取');
  });

  it('reads the global Artifact lens from the shared ledger and opens its Project', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ artifacts: [{
        id: 'artifact-1', projectId: project.id, ref: 'reports/result.md', label: 'result.md',
        kind: 'document', status: 'registered', updatedAt: '2026-08-27T00:00:00.000Z',
        updatedBy: 'builder', operations: ['register'], workTitle: 'Agent 协作结果',
      }] }),
    }));
    const onOpenProject = vi.fn();
    render(<ProjectsOverview projects={[project]} conversations={[]} tasks={[]} blockers={{}} lens="artifacts" onOpenProject={onOpenProject} />);

    expect(await screen.findByText('result.md')).toBeDefined();
    expect(screen.getByText('alpha · Agent 协作结果')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /result.md/ }));
    expect(onOpenProject).toHaveBeenCalledWith(project);
  });
});
