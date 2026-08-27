// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFilterBar } from '@/components/task-hub/ChatFilterBar';

afterEach(cleanup);

describe('ChatFilterBar', () => {
  it('clears and hides filters when the current timeline becomes short', () => {
    const onFilterChange = vi.fn();
    const { rerender } = render(<ChatFilterBar key="project-a" messageCount={20} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByRole('button', { name: '搜索和筛选消息' }));
    fireEvent.change(screen.getByPlaceholderText('搜索…'), { target: { value: '旧项目' } });
    expect(onFilterChange).toHaveBeenLastCalledWith(expect.objectContaining({ search: '旧项目' }));

    rerender(<>{5 >= 20 && <ChatFilterBar key="project-b" messageCount={5} onFilterChange={onFilterChange} />}</>);

    expect(screen.queryByRole('button', { name: '搜索和筛选消息' })).toBeNull();
    expect(screen.queryByPlaceholderText('搜索…')).toBeNull();

    rerender(<ChatFilterBar key="project-b" messageCount={20} onFilterChange={onFilterChange} />);
    expect(onFilterChange).toHaveBeenLastCalledWith({
      search: '', intent: null, agentId: null, userOnly: false,
    });
  });
});
