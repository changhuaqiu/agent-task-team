import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '@/pages/api/team-packs/[packId]';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  return res;
}

describe('/api/team-packs/[packId]', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the current Agent-ref projection', () => {
    const team = { id: 'pack-1', roles: [{ id: 'planner', displayName: 'Planner', soul: '', required: true }] };
    vi.spyOn(teamPackRepo, 'getById').mockReturnValue(team as any);
    const res = mockRes();
    handler({ method: 'GET', query: { packId: 'pack-1' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(team);
  });

  it.each(['POST', 'PATCH', 'DELETE'])('disables direct %s writes', (method) => {
    const res = mockRes();
    handler({ method, query: { packId: 'pack-1' }, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: 'use_product_command' }));
  });
});
