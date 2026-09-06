// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkStartPanel } from '@/components/project/WorkStartPanel';
import { useTaskHubStore, type WorkspaceProject } from '@/store/taskHubStore';
import type { ProjectWorkItem } from '@/lib/project-work-items';
const project: WorkspaceProject = { id: 'p', name: 'P', rootPath: 'C:/p', workspaceConversationId: 'workspace', agentIds: ['mario'], createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z' };
const item: ProjectWorkItem = { id: 'pending', projectId: 'p', conversationId: 'pending', title: 'Goal', description: 'acceptance', tasks: [], childTasks: [], status: 'proposed', category: 'issue', agentId: '', createdAt: project.createdAt, updatedAt: project.updatedAt, legacy: false };
let submit: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  sessionStorage.clear();
  const mario = useTaskHubStore.getState().agentRoster.find((agent) => agent.id === 'mario')!;
  useTaskHubStore.setState({ agentRoster: [{ ...mario, id: 'mario', name: 'Mario', responsibility: 'coordinator' }], activeAgentIds: ['mario'] });
  submit = vi.spyOn(useTaskHubStore.getState(), 'addChatMessage').mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('explicit team arrangement', () => {
  it('does not dispatch on creation and labels successful submit as receipt, not execution', async () => {
    render(<WorkStartPanel item={item} project={project} onOpenActivity={vi.fn()} />);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '交给团队安排' }));
    await screen.findByText('安排请求已提交');
    expect(screen.getByText(/不代表 Agent 已开始执行/)).toBeTruthy();
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'pending', content: expect.stringContaining('@mario') }));
  });
  it('reuses exact command issuance after unmount and retry', async () => {
    submit.mockResolvedValue({ ok: false, error: 'temporarily unavailable' });
    const first = render(<WorkStartPanel item={item} project={project} onOpenActivity={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '交给团队安排' }));
    await screen.findByRole('alert');
    first.unmount();
    render(<WorkStartPanel item={item} project={project} onOpenActivity={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '交给团队安排' }));
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1][0]).toEqual(submit.mock.calls[0][0]);
  });
  it('offers team configuration when no coordinator belongs to the project', () => {
    const manage = vi.fn();
    render(<WorkStartPanel item={item} project={{ ...project, agentIds: [] }} onOpenActivity={vi.fn()} onManageTeam={manage} />);
    expect(screen.queryByRole('button', { name: '交给团队安排' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '配置项目团队' }));
    expect(manage).toHaveBeenCalledOnce();
  });
});
