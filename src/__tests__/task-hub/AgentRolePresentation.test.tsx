// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentBar } from '@/components/task-hub/AgentBar';
import { AgentMentionPopup } from '@/components/task-hub/AgentMentionPopup';
import { AgentRosterModal } from '@/components/task-hub/AgentRosterModal';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { roleCardToSnapshot } from '@/server/team-pack-role-snapshot';
import { useTaskHubStore } from '@/store/taskHubStore';
import type { TeamPack } from '@/types/teamPack';

afterEach(() => cleanup());

describe('Agent role presentation', () => {
  it('renders the RoleCard label and drops it when the RoleCard is unavailable', () => {
    useTaskHubStore.setState({
      activeAgentIds: ['mario'],
      roleCards: [...PRESET_ROLE_CARDS],
      tasks: [],
      accounts: [],
    });

    render(<AgentBar />);

    expect(screen.getByText('Mario')).toBeDefined();
    expect(screen.getByText('项目统筹')).toBeDefined();

    act(() => useTaskHubStore.setState({ roleCards: [] }));

    expect(screen.getByText('Mario')).toBeDefined();
    expect(screen.queryByText('项目统筹')).toBeNull();
  });

  it('shows and selects a TeamPack snapshot RoleCard in the mention popup', () => {
    const teamPack = {
      id: 'pack-mention-role', specVersion: 'team-pack/0.1', name: 'pack-mention-role',
      displayName: 'Mention role', description: '', version: '1.0.0', tags: [], category: 'test',
      teamMode: 'pipeline', workflow: { type: 'linear' }, communicationMatrix: {}, isPreset: false,
      createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
      roles: [{
        id: 'planner', displayName: 'Member Planner', soul: '', required: true,
        roleCardSnapshot: roleCardToSnapshot({
          ...PRESET_ROLE_CARDS[0],
          displayName: 'SnapshotPlanner',
        }),
      }],
    } satisfies TeamPack;
    useTaskHubStore.setState({
      conversations: [{
        id: 'conv-mention-role', title: 'Mention role', goal: '', status: 'active', priority: 'p1',
        projectPath: '', breakdownStatus: 'none', teamPackId: teamPack.id,
        createdAt: '2026-08-15T00:00:00.000Z', updatedAt: '2026-08-15T00:00:00.000Z',
      }],
      selectedConversationId: 'conv-mention-role',
      currentTeamPack: teamPack,
      activeAgentIds: ['planner'],
      roleCards: [...PRESET_ROLE_CARDS],
    });
    const onSelect = vi.fn();

    render(
      <AgentMentionPopup
        inputValue="@SnapshotPlanner"
        cursorPosition={16}
        selectedIndex={0}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Member Planner')).toBeDefined();
    expect(screen.getByText('SnapshotPlanner')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Member Planner/ }));
    expect(onSelect).toHaveBeenCalledWith('planner');
  });

  it('reacts to RoleCard updates while the roster modal is open', () => {
    useTaskHubStore.setState({
      selectedConversationId: null,
      currentTeamPack: null,
      activeAgentIds: ['mario'],
      roleCards: [...PRESET_ROLE_CARDS],
      isRosterModalOpen: true,
    });

    render(<AgentRosterModal />);
    expect(screen.getAllByText('全栈开发').length).toBeGreaterThan(0);

    act(() => useTaskHubStore.setState({
      roleCards: PRESET_ROLE_CARDS.map((card) => (
        card.id === 'preset-frontend' ? { ...card, displayName: 'Updated Frontend Role' } : card
      )),
    }));

    expect(screen.getByText('Updated Frontend Role')).toBeDefined();
  });
});
