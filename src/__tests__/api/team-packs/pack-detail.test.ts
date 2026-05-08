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
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes member snapshots', () => {
    const pack = {
      id: 'pack-1',
      roles: [{ id: 'planner', displayName: '规划师', roleCardSnapshot: { displayName: '规划师' } }],
    };
    vi.spyOn(teamPackRepo, 'materializeRoleSnapshots').mockReturnValue(pack as any);

    const req: any = {
      method: 'POST',
      query: { packId: 'pack-1' },
      body: { action: 'materializeRoleSnapshots' },
    };
    const res = mockRes();

    handler(req, res);

    expect(teamPackRepo.materializeRoleSnapshots).toHaveBeenCalledWith('pack-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(pack);
  });

  it('exports a self-contained team pack without mutating storage', () => {
    const pack = {
      id: 'pack-1',
      roles: [{ id: 'planner', displayName: '规划师', roleCardSnapshot: { displayName: '规划师' } }],
    };
    vi.spyOn(teamPackRepo, 'getExportById').mockReturnValue(pack as any);

    const req: any = {
      method: 'GET',
      query: { packId: 'pack-1', export: '1' },
      body: {},
    };
    const res = mockRes();

    handler(req, res);

    expect(teamPackRepo.getExportById).toHaveBeenCalledWith('pack-1');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(pack);
  });

  it('patches editable team pack fields', () => {
    const update = vi.spyOn(teamPackRepo, 'update').mockReturnValue(undefined);
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1' },
      body: {
        displayName: 'Edited Pack',
        description: 'After',
        teamMode: 'parallel',
        roles: [{ id: 'writer', displayName: '撰稿人', soul: '# 撰稿人', required: true }],
      },
    };
    const res = mockRes();

    handler(req, res);

    expect(update).toHaveBeenCalledWith('pack-1', req.body);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
