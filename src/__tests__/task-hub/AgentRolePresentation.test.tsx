// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentBar } from '@/components/task-hub/AgentBar';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { useTaskHubStore } from '@/store/taskHubStore';

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
});
