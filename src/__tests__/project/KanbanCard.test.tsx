// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { KanbanCard } from '@/components/project/KanbanCard';
import type { Task } from '@/store/taskHubStore';

afterEach(cleanup);

// Mock @dnd-kit/sortable so useSortable returns deterministic values
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: (args: { id: string }) => ({
    attributes: { role: 'button', tabIndex: 0, 'aria-disabled': false },
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
    id: args.id,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => null,
    },
  },
}));

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'TASK-1',
    conversationId: 'conv-1',
    phaseId: '',
    title: 'Test task',
    description: 'A test task',
    status: 'ready',
    agentId: 'mario',
    dependencies: [],
    artifacts: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
    revision: overrides.revision ?? 0,
  };
}

describe('KanbanCard', () => {
  it('renders task ID, title, and agent', () => {
    const task = makeTask();
    render(<KanbanCard task={task} />);

    expect(screen.getByTestId('kanban-card-TASK-1')).toBeTruthy();
    expect(screen.getByText('Test task')).toBeTruthy();
    expect(screen.getByText('@mario')).toBeTruthy();
  });

  it('shows phase tag when phaseId is set', () => {
    const task = makeTask({ phaseId: 'phase-alpha' });
    render(<KanbanCard task={task} />);

    expect(screen.getByText('phase-alpha')).toBeTruthy();
  });

  it('hides phase tag when phaseId is empty', () => {
    const task = makeTask({ phaseId: '' });
    const { container } = render(<KanbanCard task={task} />);

    // The text "phase-alpha" should not exist
    expect(screen.queryByText('phase-alpha')).toBeNull();
  });

  it('shows dependency count when deps exist', () => {
    const task = makeTask({ dependencies: ['TASK-2', 'TASK-3'] });
    render(<KanbanCard task={task} />);

    expect(screen.getByText('2')).toBeTruthy();
  });

  it('does not show dependency count when deps are empty', () => {
    const task = makeTask({ dependencies: [] });
    const { container } = render(<KanbanCard task={task} />);

    // ChevronRight icon should not be present
    const chevrons = container.querySelectorAll('svg.lucide-chevron-right');
    expect(chevrons.length).toBe(0);
  });

  it('shows artifact icon when artifacts exist', () => {
    const task = makeTask({
      artifacts: [
        { type: 'file', label: 'index.ts' },
        { type: 'link', label: 'PR', url: 'https://example.com' },
      ],
    });
    render(<KanbanCard task={task} />);

    expect(screen.getByTitle('file')).toBeTruthy();
    expect(screen.getByTitle('link')).toBeTruthy();
  });

  it('shows "Unassigned" when agentId is empty', () => {
    const task = makeTask({ agentId: '' });
    render(<KanbanCard task={task} />);

    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('shows "Unassigned" when agentId is "-"', () => {
    const task = makeTask({ agentId: '-' });
    render(<KanbanCard task={task} />);

    expect(screen.getByText('Unassigned')).toBeTruthy();
  });

  it('applies agent theme left border class', () => {
    const task = makeTask({ agentId: 'luigi' });
    const { container } = render(<KanbanCard task={task} />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-[hsl(var(--agent-luigi))]');
  });

  it('applies explicit theme prop over agentId resolution', () => {
    const task = makeTask({ agentId: 'mario' });
    const { container } = render(<KanbanCard task={task} theme="peach" />);

    // This test ensures the theme prop is accepted; class should use peach
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('border-l-[hsl(var(--agent-peach))]');
  });

  it('applies muted styles for blocked tasks', () => {
    const task = makeTask({ status: 'blocked' });
    const { container } = render(<KanbanCard task={task} />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('opacity-80');
  });

  it('applies muted styles for cancelled tasks', () => {
    const task = makeTask({ status: 'cancelled' });
    const { container } = render(<KanbanCard task={task} />);

    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('opacity-80');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const task = makeTask();
    render(<KanbanCard task={task} onClick={onClick} />);

    const card = screen.getByTestId('kanban-card-TASK-1');
    fireEvent.click(card);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('calls onContextMenu when right-clicked', () => {
    const onContextMenu = vi.fn();
    const task = makeTask();
    render(<KanbanCard task={task} onContextMenu={onContextMenu} />);

    const card = screen.getByTestId('kanban-card-TASK-1');
    fireEvent.contextMenu(card);
    expect(onContextMenu).toHaveBeenCalledOnce();
  });
});
