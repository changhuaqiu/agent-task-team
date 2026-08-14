// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { A2APossessionStrip } from '@/components/task-hub/A2APossessionStrip';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import { useTaskHubStore } from '@/store/taskHubStore';
import { roleCardToSnapshot } from '@/server/team-pack-role-snapshot';

beforeEach(() => {
  useTaskHubStore.setState({
    conversations: [{
      id: 'conv-receipt',
      title: 'Dispatch receipt',
      goal: 'Show dispatch receipt visibility',
      status: 'active',
      priority: 'p1',
      projectPath: '',
      breakdownStatus: 'none',
      createdAt: '2026-05-17T00:00:00.000Z',
      updatedAt: '2026-05-17T00:00:00.000Z',
    }],
    selectedConversationId: 'conv-receipt',
    selectedProjectId: 'conv-receipt',
    activeAgentIds: ['mario', 'luigi'],
    currentTeamPack: null,
    roleCards: [...PRESET_ROLE_CARDS],
    dispatchReceiptsByConversation: {
      'conv-receipt': [{
        projectId: 'conv-receipt',
        receiptId: 'env-1:acknowledged',
        conversationId: 'conv-receipt',
        taskId: 'TASK-001',
        targetAgentId: 'mario',
        source: 'workflow',
        phase: 'acknowledged',
        createdAt: '2026-05-17T00:01:00.000Z',
      }],
    },
    a2aByConversation: {},
  });
});

afterEach(() => {
  cleanup();
});

describe('A2APossessionStrip', () => {
  it('surfaces dispatch receipt state even without an A2A handoff', () => {
    render(<A2APossessionStrip />);

    expect(screen.getByText('派发回执')).toBeTruthy();
    expect(screen.getByText(/已确认接纳/)).toBeTruthy();
    expect(screen.getAllByText(/Mario/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/项目统筹/)).toBeNull();
  });

  it('uses the TeamPack member name instead of the snapshot RoleCard name', () => {
    useTaskHubStore.setState({
      conversations: [{
        id: 'conv-receipt', title: 'Dispatch receipt', goal: '', status: 'active', priority: 'p1',
        projectPath: '', breakdownStatus: 'none', teamPackId: 'pack-receipt',
        createdAt: '2026-05-17T00:00:00.000Z', updatedAt: '2026-05-17T00:00:00.000Z',
      }],
      currentTeamPack: {
        id: 'pack-receipt', specVersion: 'team-pack/0.1', name: 'pack-receipt', displayName: 'Receipt team',
        description: '', version: '1.0.0', tags: [], category: 'test', teamMode: 'pipeline',
        workflow: { type: 'linear' }, communicationMatrix: {}, isPreset: false,
        createdAt: '2026-05-17T00:00:00.000Z', updatedAt: '2026-05-17T00:00:00.000Z',
        roles: [{
          id: 'mario', displayName: 'Team Captain', soul: '', required: true,
          roleCardSnapshot: roleCardToSnapshot({
            ...PRESET_ROLE_CARDS[0],
            displayName: 'Snapshot Planner',
          }),
        }],
      },
      activeAgentIds: ['mario'],
    });

    render(<A2APossessionStrip />);

    expect(screen.getAllByText(/Team Captain/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Snapshot Planner/)).toBeNull();
  });
});
