// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
import { useTaskHubStore } from '@/store/taskHubStore';

vi.mock('@/components/project/ProjectSidebar', () => ({
  ProjectSidebar: () => <aside data-testid="project-sidebar"/>,
}));
vi.mock('@/components/project/ProjectChatPanel', () => ({
  ProjectChatPanel: () => <section data-testid="collaboration-workspace"/>,
}));
vi.mock('@/components/project/ProjectRightPanel', () => ({
  ProjectRightPanel: () => <aside data-testid="project-right-panel"/>,
}));
vi.mock('@/components/project/ProjectEvaluationWorkspace', () => ({
  ProjectEvaluationWorkspace: ({ conversationId }: { conversationId?: string }) =>
    <section data-testid="evaluation-workspace">{conversationId}</section>,
}));
vi.mock('@/components/project/AgentObservabilityDrawer', () => ({
  AgentObservabilityDrawer: () => <aside data-testid="observability-drawer-host"/>,
}));

afterEach(cleanup);

describe('ProjectWorkspace', () => {
  it('switches the same selected delivery between delivery and evaluation modes', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-platform',
      conversations: [{
        id: 'conv-platform', title: '平台内建评估', goal: '同一项目上下文',
        status: 'active', priority: 'p1', projectPath: '',
        breakdownStatus: 'none', createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      }],
    });
    render(<ProjectWorkspace />);
    expect(screen.getByTestId('collaboration-workspace')).toBeDefined();
    expect(screen.queryByTestId('evaluation-workspace')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '评估' }));
    expect(screen.queryByTestId('collaboration-workspace')).toBeNull();
    expect(screen.getByTestId('evaluation-workspace').textContent).toBe('conv-platform');
    expect(screen.getByTestId('project-sidebar')).toBeDefined();
    expect(screen.getByTestId('observability-drawer-host')).toBeDefined();
  });
});
