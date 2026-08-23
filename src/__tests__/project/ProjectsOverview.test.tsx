// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectsOverview } from '@/components/project/ProjectsOverview';
import type { ProjectNavigationGroup } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

afterEach(cleanup);

const navigation: ProjectNavigationGroup[] = [{
  key: 'C:/projects/alpha',
  name: 'alpha',
  fullPath: 'C:/projects/alpha',
  deliveries: [{
    id: 'delivery-alpha', title: 'Alpha delivery', goal: '', status: 'active', autonomous: true,
    projectPath: 'C:/projects/alpha', projectName: 'alpha',
    updatedAt: '2026-08-23T00:00:00.000Z',
    work: { total: 4, blocked: 0, inProgress: 1, done: 3 },
    openBlockerCount: 1,
  }, {
    id: 'delivery-paused', title: 'Paused delivery', goal: 'Wait for approval', status: 'paused', autonomous: false,
    projectPath: 'C:/projects/alpha', projectName: 'alpha',
    updatedAt: '2026-08-22T00:00:00.000Z',
    work: { total: 0, blocked: 0, inProgress: 0, done: 0 },
    openBlockerCount: 0,
  }],
}];

describe('ProjectsOverview', () => {
  it('keeps project context and delivery work visible in the same overview', () => {
    const onOpenDelivery = vi.fn();
    render(<ProjectsOverview navigation={navigation} onOpenDelivery={onOpenDelivery} />);

    expect(screen.getByLabelText('项目：1')).toBeDefined();
    expect(screen.getByLabelText('可继续交付：2')).toBeDefined();
    expect(screen.getByText('最近更新的可继续交付')).toBeDefined();
    expect(screen.getByText('2 可继续 / 2 交付')).toBeDefined();
    expect(screen.getAllByText('任务 3/4')).toHaveLength(2);
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getAllByText('Alpha delivery')).toHaveLength(2);
    expect(screen.getAllByText('Paused delivery')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '打开交付：alpha / Alpha delivery' }));
    expect(onOpenDelivery).toHaveBeenCalledWith('delivery-alpha');
  });

  it('owns the only empty-state guidance when no project exists', () => {
    render(<ProjectsOverview navigation={[]} onOpenDelivery={vi.fn()} />);

    expect(screen.getByRole('heading', { name: '从第一个交付开始建立项目工作区' })).toBeDefined();
    expect(screen.getAllByText(/使用右上角“新建交付”选择项目目录/)).toHaveLength(1);
  });
});
