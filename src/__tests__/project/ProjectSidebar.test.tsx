// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectSidebar } from '@/components/project/ProjectSidebar';
import type { WorkspaceProject } from '@/store/taskHubStore';

afterEach(cleanup);

const projects: WorkspaceProject[] = [
  { id: 'alpha', name: 'alpha', rootPath: 'C:/projects/alpha', workspaceConversationId: 'workspace-alpha', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
  { id: 'bravo', name: 'bravo', rootPath: 'C:/projects/bravo', workspaceConversationId: 'workspace-bravo', createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' },
];

function renderSidebar(overrides: Partial<React.ComponentProps<typeof ProjectSidebar>> = {}) {
  const props: React.ComponentProps<typeof ProjectSidebar> = {
    projects,
    conversations: [],
    tasks: [],
    activeSurface: 'activity',
    selectedProjectId: null,
    onOpenActivity: vi.fn(),
    onOpenAgents: vi.fn(),
    onOpenProjects: vi.fn(),
    onOpenSettings: vi.fn(),
    onSelectProject: vi.fn(),
    ...overrides,
  };
  return { ...render(<ProjectSidebar {...props} />), props };
}

describe('ProjectSidebar', () => {
  it('keeps activity, agents, and projects as stable first-level objects', () => {
    const onSelectProject = vi.fn();
    renderSidebar({ onSelectProject });
    expect(screen.getByRole('button', { name: '收件箱' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Agents' })).toBeDefined();
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.queryByText(/交付/)).toBeNull();
    fireEvent.click(screen.getByText('bravo'));
    expect(onSelectProject).toHaveBeenCalledWith(projects[1]);
  });

  it('collapses to object-level navigation without delivery shortcuts', () => {
    renderSidebar({ activeSurface: 'project', selectedProjectId: 'alpha' });
    fireEvent.click(screen.getByRole('button', { name: '收起工作区侧栏' }));
    expect(screen.getByTitle('收件箱')).toBeDefined();
    expect(screen.getByTitle('Agents')).toBeDefined();
    expect(screen.getByTitle('Projects')).toBeDefined();
    expect(screen.queryByText('bravo')).toBeNull();
  });
});
