// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MiniKanban } from '@/components/project/MiniKanban';
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
  useSortable: (args: { id: string }) => ({
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

describe('MiniKanban integration', () => {
  it('renders status columns with task cards', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      tasks: [
        {
          id: 'TASK-001',
          conversationId: 'conv-1',
          phaseId: 'P1',
          title: 'Build API',
          description: 'Create REST endpoints',
          status: 'pending',
          agentId: 'luigi',
          dependencies: [],
          artifacts: [],
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
        },
        {
          id: 'TASK-002',
          conversationId: 'conv-1',
          phaseId: '',
          title: 'Write tests',
          description: 'Unit and integration tests',
          status: 'in_progress',
          agentId: 'toad',
          dependencies: ['TASK-001'],
          artifacts: [{ type: 'file', label: 'test.ts' }],
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
        },
      ],
      phases: [],
    });

    render(<MiniKanban />);
    expect(screen.getByText('TASK-001')).toBeDefined();
    expect(screen.getByText('TASK-002')).toBeDefined();
    expect(screen.getByText('Build API')).toBeDefined();
    expect(screen.getByText('Write tests')).toBeDefined();
  });

  it('does not crash when persisted state still contains a managed ready status', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-managed',
      tasks: [{
        id: 'TASK-READY',
        conversationId: 'conv-managed',
        phaseId: '',
        title: 'Managed ready task',
        description: '',
        status: 'ready' as never,
        agentId: 'luigi',
        dependencies: [],
        artifacts: [],
        createdAt: '2026-08-02T00:00:00Z',
        updatedAt: '2026-08-02T00:00:00Z',
      }],
      phases: [],
    });

    render(<MiniKanban />);

    expect(screen.getByText('Managed ready task')).toBeDefined();
  });

  it('renders without expand button when no callback', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      tasks: [],
      phases: [],
    });

    render(<MiniKanban expanded={false} />);
    expect(screen.getByText('看板')).toBeDefined();
  });

  it('accepts expanded prop', () => {
    render(<MiniKanban expanded={true} />);
    expect(screen.getByText('看板')).toBeDefined();
  });

  it('renders column headers with correct labels', () => {
    render(<MiniKanban />);
    expect(screen.getByText('待处理')).toBeDefined();
    expect(screen.getByText('进行中')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
  });
});
