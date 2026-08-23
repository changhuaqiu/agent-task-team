import { beforeEach, describe, expect, it } from 'vitest';
import { socket } from '@/store/daemonStore';
import { useTaskHubStore } from '@/store/taskHubStore';

function emitProjectView(payload: Record<string, unknown>) {
  (socket as unknown as { emitEvent(args: unknown[]): void }).emitEvent(['project:view', {
    version: 2,
    envelopeVersion: 1,
    eventId: 'event-a2a-snapshot',
    projectId: 'project-a2a-view',
    occurredAt: '2026-07-28T00:00:00.000Z',
    type: 'a2a.snapshot',
    delivery: 'durable',
    actor: { type: 'system', id: 'a2a-projection' },
    correlationId: 'chain-1',
    causationId: 'a2a-source-1',
    payload,
  }]);
}

describe('A2A project view projection', () => {
  beforeEach(() => {
    useTaskHubStore.setState({
      selectedConversationId: 'project-a2a-view',
      selectedProjectId: 'project-a2a-view',
      a2aByConversation: {},
    });
  });

  it('replaces local A2A state with the authoritative snapshot', () => {
    const snapshot = {
      conversationId: 'project-a2a-view',
      chainId: 'chain-1',
      revision: 3,
      currentHolderIds: ['builder', 'reviewer'],
      status: 'active',
      updatedAt: '2026-07-28T00:00:00.000Z',
      handoffs: [{
        id: 'pass-1',
        chainId: 'chain-1',
        passId: 'pass-1',
        fromAgentId: 'planner',
        toAgentId: 'builder',
        status: 'started',
        intent: 'implement',
        timestamp: '2026-07-28T00:00:00.000Z',
      }],
    };

    emitProjectView({ snapshot });

    expect(useTaskHubStore.getState().a2aByConversation['project-a2a-view'])
      .toEqual(snapshot);
  });

  it('rejects snapshots for a different project', () => {
    emitProjectView({
      snapshot: {
        conversationId: 'another-project',
        chainId: 'chain-foreign',
        currentHolderIds: [],
        handoffs: [],
      },
    });

    expect(useTaskHubStore.getState().a2aByConversation).toEqual({});
  });
});
