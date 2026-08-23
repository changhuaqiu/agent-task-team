// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectSidebar } from '@/components/project/ProjectSidebar';
import type { ProjectNavigationGroup } from '@/lib/delivery-workspace/DeliveryWorkspaceProjection';

afterEach(cleanup);

const navigation: ProjectNavigationGroup[] = [
  {
    key: 'C:/projects/alpha',
    name: 'alpha',
    fullPath: 'C:/projects/alpha',
    deliveries: [{
      id: 'delivery-alpha', title: 'Alpha delivery', goal: 'Ship alpha', status: 'active', autonomous: true,
      projectPath: 'C:/projects/alpha', projectName: 'alpha',
      updatedAt: '2026-08-23T00:00:00.000Z',
      work: { total: 2, blocked: 0, inProgress: 1, done: 1 },
      openBlockerCount: 0,
    }],
  },
  {
    key: 'C:/projects/bravo',
    name: 'bravo',
    fullPath: 'C:/projects/bravo',
    deliveries: [{
      id: 'delivery-bravo', title: 'Bravo delivery', goal: 'Ship bravo', status: 'paused', autonomous: false,
      projectPath: 'C:/projects/bravo', projectName: 'bravo',
      updatedAt: '2026-08-23T01:00:00.000Z',
      work: { total: 1, blocked: 1, inProgress: 0, done: 0 },
      openBlockerCount: 1,
    }],
  },
];

describe('ProjectSidebar', () => {
  it('keeps the global overview separate from named projects and their deliveries', () => {
    const onOpenOverview = vi.fn();
    const onSelectDelivery = vi.fn();
    render(
      <ProjectSidebar
        navigation={navigation}
        activeSurface="overview"
        selectedDeliveryId="delivery-alpha"
        onOpenOverview={onOpenOverview}
        onSelectDelivery={onSelectDelivery}
      />,
    );

    expect(screen.getByRole('button', { name: '交付总览' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText('alpha')).toBeDefined();
    expect(screen.getByText('bravo')).toBeDefined();
    expect(screen.getByText('Alpha delivery')).toBeDefined();
    expect(screen.getByText('Bravo delivery')).toBeDefined();

    fireEvent.click(screen.getByText('Bravo delivery'));
    expect(onSelectDelivery).toHaveBeenCalledWith('delivery-bravo');
  });

  it('collapses to the overview and current-delivery shortcuts', () => {
    render(
      <ProjectSidebar
        navigation={navigation}
        activeSurface="delivery"
        selectedDeliveryId="delivery-alpha"
        onOpenOverview={vi.fn()}
        onSelectDelivery={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起工作区侧栏' }));
    expect(screen.getByRole('button', { name: '交付总览' })).toBeDefined();
    expect(screen.getByRole('button', { name: '当前交付' })).toBeDefined();
    expect(screen.queryByText('bravo')).toBeNull();
  });

  it('does not duplicate the page empty-state guidance', () => {
    render(
      <ProjectSidebar
        navigation={[]}
        activeSurface="overview"
        selectedDeliveryId={null}
        onOpenOverview={vi.fn()}
        onSelectDelivery={vi.fn()}
      />,
    );

    expect(screen.queryByText(/新建交付并选择目录/)).toBeNull();
  });
});
