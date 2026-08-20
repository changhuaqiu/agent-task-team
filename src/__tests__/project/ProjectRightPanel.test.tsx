// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectRightPanel } from '@/components/project/ProjectRightPanel';
import { useTaskHubStore } from '@/store/taskHubStore';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div data-testid="dnd-context">{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  closestCorners: vi.fn(),
  pointerWithin: vi.fn(),
  PointerSensor: vi.fn(),
  TouchSensor: vi.fn(),
  useSensor: vi.fn(),
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: vi.fn(), isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  verticalListSortingStrategy: 'vertical',
  useSortable: () => ({
    attributes: { role: 'button', tabIndex: 0 },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => null } },
}));

describe('ProjectRightPanel', () => {
  it('shows one task workspace and loads the task graph only after map intent', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        conversationId: 'conv-plain', tasks: [], edges: [], artifacts: [], revision: 0,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      selectedConversationId: 'conv-plain',
      conversations: [{
        id: 'conv-plain',
        title: 'Plain delivery',
        goal: 'Ship the requested change',
        status: 'active',
        priority: 'p1',
        projectPath: 'C:\\workspace\\plain-project',
        breakdownStatus: 'confirmed',
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
      }],
      tasks: [{
        id: 'TASK-001',
        conversationId: 'conv-plain',
        phaseId: '',
        title: 'Plain project task',
        description: '',
        status: 'ready',
        agentId: 'mario',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-05-07T00:00:00.000Z',
        updatedAt: '2026-05-07T00:00:00.000Z',
        revision: 0,
      }],
      phases: [],
      blockersByConversation: {},
      chatMessagesByConversation: {},
    });

    render(<ProjectRightPanel />);

    expect(screen.getByRole('tab', { name: /任务/ })).toBeDefined();
    expect(screen.getByRole('tab', { name: '调试' })).toBeDefined();
    expect(screen.queryByRole('tab', { name: '地图' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '待办' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '风险' })).toBeNull();
    expect(screen.getByText('需要关注')).toBeDefined();
    expect(screen.getByText('TASK-001')).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '关系图' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      '/api/task-graph?conversationId=conv-plain',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
  });
});
