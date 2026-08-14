import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/eval/proposals';
import { evaluationLab } from '@/server/evaluation/evaluation-lab';

vi.mock('@/server/evaluation/evaluation-lab', () => ({
  evaluationLab: {
    transitionProposal: vi.fn((input) => ({ id: input.id, status: input.action })),
  },
}));

function response() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json.mockImplementation((body: unknown) => {
    res.body = body;
    return res;
  });
  return res;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('/api/eval/proposals single-operator governance', () => {
  it('rejects approve without explicit operator confirmation', () => {
    const res = response();
    handler({
      method: 'PATCH',
      body: { id: 'proposal-1', conversationId: 'conv-1', action: 'approve' },
    } as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'single platform operator confirmation is required' });
    expect(evaluationLab.transitionProposal).not.toHaveBeenCalled();
  });

  it('records the fixed platform operator after explicit confirmation', () => {
    const res = response();
    handler({
      method: 'PATCH',
      body: {
        id: 'proposal-1',
        conversationId: 'conv-1',
        action: 'approve',
        operatorConfirmed: true,
        regressionExperimentId: 'experiment-1',
      },
    } as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(200);
    expect(evaluationLab.transitionProposal).toHaveBeenCalledWith(expect.objectContaining({
      id: 'proposal-1',
      action: 'approve',
      actorId: 'platform-operator',
      regressionExperimentId: 'experiment-1',
    }));
  });
});
