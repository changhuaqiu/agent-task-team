// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTaskHubStore } from '@/store/taskHubStore';

describe('phase persistence interface', () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as {
      type: string;
      idempotencyKey: string;
      deliveryId: string;
      projectPath: string;
      issuedAt: string;
      phase?: Record<string, unknown>;
      phaseId?: string;
    };
    const phase = command.phase ? {
      ...command.phase,
      conversationId: command.deliveryId,
      createdAt: command.issuedAt,
      updatedAt: command.issuedAt,
    } : undefined;
    return new Response(JSON.stringify({
      receipt: {
        idempotencyKey: command.idempotencyKey,
        commandType: command.type,
        projectPath: command.projectPath,
        deliveryId: command.deliveryId,
        status: 'accepted',
        duplicate: false,
        targetAgentIds: [],
        recordedAt: command.issuedAt,
        result: phase ? { phase } : { phaseId: command.phaseId, deleted: true },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  });

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    useTaskHubStore.setState({
      selectedConversationId: 'project-a',
      conversations: [{ id: 'project-a', projectPath: 'C:/project-a' }] as never,
      phases: [],
    });
  });

  it('applies authoritative phase receipts through the Workspace Command gateway', async () => {
    const id = await useTaskHubStore.getState().upsertPhase({
      conversationId: 'project-a',
      title: 'Plan',
      description: 'Plan the work',
      order: 0,
      status: 'planned',
    });

    expect(useTaskHubStore.getState().phases).toEqual([
      expect.objectContaining({ id, conversationId: 'project-a', title: 'Plan' }),
    ]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/workspace-commands', expect.objectContaining({
      method: 'POST',
      body: expect.any(String),
    }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({
      type: 'work.phase.upsert',
      deliveryId: 'project-a',
      phase: { id, title: 'Plan', status: 'planned' },
    });

    await useTaskHubStore.getState().removePhase(id);

    expect(useTaskHubStore.getState().phases).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/workspace-commands',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      type: 'work.phase.delete',
      phaseId: id,
    });
  });
});
