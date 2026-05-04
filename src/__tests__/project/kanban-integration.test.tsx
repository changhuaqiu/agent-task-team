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
  PointerSensor: vi.fn(),
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

  it('shows expand button when callback provided', () => {
    useTaskHubStore.setState({
      selectedConversationId: 'conv-1',
      tasks: [],
      phases: [],
    });

    render(<MiniKanban expanded={false} onToggleExpand={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const expandBtn = buttons.find((b) => b.querySelector('svg.lucide-maximize-2'));
    expect(expandBtn).toBeDefined();
  });

  it('shows minimize button when expanded', () => {
    render(<MiniKanban expanded={true} onToggleExpand={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const minimizeBtn = buttons.find((b) => b.querySelector('svg.lucide-minimize-2'));
    expect(minimizeBtn).toBeDefined();
  });

  it('renders column headers with correct labels', () => {
    render(<MiniKanban />);
    expect(screen.getByText('待处理')).toBeDefined();
    expect(screen.getByText('进行中')).toBeDefined();
    expect(screen.getByText('已完成')).toBeDefined();
  });
});
