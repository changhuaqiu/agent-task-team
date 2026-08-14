// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskGraphMap, type TaskGraphMapView } from '@/components/task-hub/TaskGraphMap';

afterEach(cleanup);

function graph(): TaskGraphMapView {
  return {
    conversationId: 'conv-1',
    tasks: [
      { id: 'root', title: '完整交付', status: 'in_progress', agent_id: 'pm' },
      { id: 'api', title: '任务图 API', status: 'done', agent_id: 'backend' },
      { id: 'ui', title: '群聊界面', status: 'blocked', agent_id: 'frontend' },
      { id: 'release', title: '回归发布', status: 'ready', agent_id: 'qa' },
    ],
    edges: [
      { id: 'e1', from_task_id: 'api', to_task_id: 'root', type: 'subtask_of' },
      { id: 'e2', from_task_id: 'ui', to_task_id: 'root', type: 'subtask_of' },
      { id: 'e3', from_task_id: 'api', to_task_id: 'release', type: 'merged_into' },
      { id: 'e4', from_task_id: 'ui', to_task_id: 'release', type: 'merged_into' },
      { id: 'e5', from_task_id: 'ui', to_task_id: 'api', type: 'depends_on' },
    ],
    artifacts: [
      { id: 'a1', task_id: 'api', kind: 'doc', label: 'API 说明' },
      { id: 'a2', task_id: 'ui', kind: 'design', label: '交互稿' },
    ],
  };
}

describe('TaskGraphMap', () => {
  it('renders fan-out, merge, blocker, and artifact summaries', () => {
    render(<TaskGraphMap graph={graph()} />);

    expect(screen.getByText('root → api、ui')).toBeTruthy();
    expect(screen.getByText('api、ui → release')).toBeTruthy();
    expect(screen.getByText('依赖 api')).toBeTruthy();
    expect(screen.getByText('产出 2')).toBeTruthy();
  });

  it('filters tasks by owner and status', () => {
    render(<TaskGraphMap graph={graph()} />);

    fireEvent.change(screen.getByLabelText('负责人'), { target: { value: 'frontend' } });
    expect(screen.getByText('群聊界面')).toBeTruthy();
    expect(screen.queryByText('任务图 API')).toBeNull();

    fireEvent.change(screen.getByLabelText('状态'), { target: { value: 'done' } });
    expect(screen.queryByText('群聊界面')).toBeNull();
  });

  it('notifies selected task when a node is clicked', () => {
    const onSelectTask = vi.fn();
    render(<TaskGraphMap graph={graph()} onSelectTask={onSelectTask} />);

    fireEvent.click(screen.getByRole('button', { name: /打开 任务图 API/ }));

    expect(onSelectTask).toHaveBeenCalledWith('api');
  });
});
