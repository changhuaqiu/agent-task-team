// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectRightPanel } from '@/components/project/ProjectRightPanel';
import { useTaskHubStore } from '@/store/taskHubStore';

afterEach(cleanup);

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
  it('does not block the kanban when the project has no team pack', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-plain',
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
      }],
      phases: [],
    });

    render(<ProjectRightPanel teamPackId="" />);

    expect(screen.getAllByText('看板').length).toBeGreaterThan(0);
    expect(screen.getByText('TASK-001')).toBeDefined();
    expect(screen.queryByText('请先选择团队套件')).toBeNull();
  });
});
