// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectArtifactSurface } from '@/components/project/ProjectArtifactSurface';
import type { ProjectArtifactLedgerItem } from '@/shared/project-artifact-ledger';
import type { WorkspaceProject } from '@/store/taskHubStore';

const project: WorkspaceProject = {
  id: 'alpha', name: 'Alpha', rootPath: 'C:/projects/alpha', workspaceConversationId: 'workspace-alpha',
  createdAt: '2026-08-27T00:00:00.000Z', updatedAt: '2026-08-27T00:00:00.000Z',
};

const artifacts: ProjectArtifactLedgerItem[] = [
  { id: 'registered', projectId: 'alpha', ref: 'src/main.ts', label: 'main.ts', kind: 'code', status: 'registered', updatedAt: '2026-08-27T01:00:00.000Z', updatedBy: 'builder', operations: ['edit', 'register'], workId: 'task-1', workTitle: '实现入口' },
  { id: 'working', projectId: 'alpha', ref: 'docs/plan.md', label: 'plan.md', kind: 'document', status: 'working', updatedAt: '2026-08-27T00:30:00.000Z', updatedBy: 'reviewer', operations: ['create'] },
];

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ProjectArtifactSurface', () => {
  it('shows automatic working and registered truth sources without a create action', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ artifacts }) }));
    const clipboard = { writeText: vi.fn(async () => undefined) };
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });

    render(<ProjectArtifactSurface project={project} agents={[
      { id: 'builder', name: 'Builder', emoji: '🛠️' },
      { id: 'reviewer', name: 'Reviewer', emoji: '🔍' },
      { id: 'observer', name: 'Observer', emoji: '👀' },
    ]} />);

    expect((await screen.findAllByText('main.ts')).length).toBeGreaterThan(0);
    expect(screen.getByText('plan.md')).toBeDefined();
    expect(screen.getByText('2 项')).toBeDefined();
    expect(screen.getByText('1 项已登记')).toBeDefined();
    expect(screen.getByText('2 位贡献者 · 2 项产物')).toBeDefined();
    expect(screen.queryByRole('button', { name: /创建产物/ })).toBeNull();
    expect(screen.getByText('🛠️ Builder')).toBeDefined();
    expect(screen.getByRole('region', { name: '🛠️ Builder 的交付' })).toBeDefined();
    expect(screen.getByRole('region', { name: '🔍 Reviewer 的交付' })).toBeDefined();
    expect(screen.queryByRole('region', { name: '👀 Observer 的交付' })).toBeNull();
    expect(screen.getByRole('region', { name: '实现' })).toBeDefined();
    expect(screen.getByRole('region', { name: '设计与文档' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'main.ts，已登记' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '处理中' }));
    expect(screen.queryByText('main.ts')).toBeNull();
    expect(screen.getAllByText('plan.md').length).toBeGreaterThan(0);
    expect(screen.getByText('Agent 正在形成结果')).toBeDefined();
    expect(screen.queryByRole('region', { name: '🛠️ Builder 的交付' })).toBeNull();
    expect(screen.getByRole('region', { name: '🔍 Reviewer 的交付' })).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索产物' }), { target: { value: '不存在' } });
    expect(screen.getByText('没有匹配的产物')).toBeDefined();

    fireEvent.change(screen.getByRole('textbox', { name: '搜索产物' }), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '全部' }));
    fireEvent.click(screen.getByRole('button', { name: 'main.ts，已登记' }));
    expect(screen.getByRole('button', { name: 'main.ts，已登记' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '复制引用' }));
    await vi.waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('src/main.ts'));
  });
});
