// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectReleaseSurface } from '@/components/project/ProjectReleaseSurface';
import type { WorkspaceProject } from '@/store/taskHubStore';
import type { Task } from '@/store/taskStore';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const project: WorkspaceProject = { id: 'release-project', name: 'Release Project', rootPath: 'C:/release', workspaceConversationId: 'release-workspace', createdAt: '', updatedAt: '' };
const task: Task = { id: 'work-done', conversationId: 'release-workspace', phaseId: '', title: 'Desktop verified', category: 'change_request', description: '', status: 'done', agentId: '', dependencies: [], artifacts: [], createdAt: '', updatedAt: '', revision: 1 };

describe('ProjectReleaseSurface', () => {
  it('creates a Project-scoped release draft from selected formal objects', async () => {
    const commands: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('/api/releases')) return { ok: true, json: async () => ({ releases: [] }) };
      if (url.startsWith('/api/reviews')) return { ok: true, json: async () => ({ reviews: [] }) };
      commands.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return { ok: true, json: async () => ({ status: 'applied' }) };
    }));
    render(<ProjectReleaseSurface project={project} tasks={[task]} />);
    fireEvent.click(await screen.findByRole('button', { name: '创建发布' }));
    fireEvent.change(screen.getByPlaceholderText('例如：v1.0 桌面预览'), { target: { value: 'v1 preview' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '创建草稿' }));
    await waitFor(() => expect(commands[0]).toMatchObject({
      name: 'release.create', projectId: project.id,
      input: { name: 'v1 preview', targets: [{ type: 'work', id: task.id }] },
    }));
  });
});
