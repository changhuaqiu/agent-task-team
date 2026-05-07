import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from '@/pages/api/team-packs/[packId]/roles/[roleId]';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';

function mockRes() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  res.setHeader = vi.fn(() => res);
  return res;
}

describe('/api/team-packs/[packId]/roles/[roleId]', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('patches role account and skill IDs', () => {
    const updatedRole = {
      id: 'planner',
      displayName: '规划师',
      soul: '# 规划师',
      required: true,
      accountIds: ['acc-1'],
      skillIds: ['skill-1'],
    };
    vi.spyOn(teamPackRepo, 'updateRoleConfig').mockReturnValue(updatedRole as any);

    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { accountIds: ['acc-1'], skillIds: ['skill-1'] },
    };
    const res = mockRes();

    handler(req, res);

    expect(teamPackRepo.updateRoleConfig).toHaveBeenCalledWith('pack-1', 'planner', {
      accountIds: ['acc-1'],
      skillIds: ['skill-1'],
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ role: updatedRole });
  });

  it('rejects unknown fields', () => {
    const updateRoleConfig = vi.spyOn(teamPackRepo, 'updateRoleConfig');
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { runtime: 'internal' },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: '不允许更新字段: runtime' });
    expect(updateRoleConfig).not.toHaveBeenCalled();
  });

  it('rejects non-string account and skill IDs', () => {
    const updateRoleConfig = vi.spyOn(teamPackRepo, 'updateRoleConfig');
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { accountIds: [123], skillIds: [{}] },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'accountIds 必须是字符串数组' });
    expect(updateRoleConfig).not.toHaveBeenCalled();
  });

  it('rejects malformed role card snapshots', () => {
    const updateRoleConfig = vi.spyOn(teamPackRepo, 'updateRoleConfig');
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: { roleCardSnapshot: { displayName: '规划师' } },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'roleCardSnapshot 缺少字段: name' });
    expect(updateRoleConfig).not.toHaveBeenCalled();
  });

  it('rejects structurally incomplete role card snapshots', () => {
    const updateRoleConfig = vi.spyOn(teamPackRepo, 'updateRoleConfig');
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: {
        roleCardSnapshot: {
          name: 'planner',
          displayName: '规划师',
          description: 'Plans work',
          category: 'planner',
          snapshottedAt: '2026-05-06T00:00:00.000Z',
          snapshotVersion: 1,
        },
      },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'roleCardSnapshot 缺少字段: tags' });
    expect(updateRoleConfig).not.toHaveBeenCalled();
  });

  it('returns 404 when role is not found', () => {
    vi.spyOn(teamPackRepo, 'updateRoleConfig').mockReturnValue(undefined);
    const req: any = {
      method: 'PATCH',
      query: { packId: 'pack-1', roleId: 'missing' },
      body: { accountIds: ['acc-1'] },
    };
    const res = mockRes();

    handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Team pack role not found' });
  });

  it('rejects non-PATCH methods with Allow header', () => {
    const updateRoleConfig = vi.spyOn(teamPackRepo, 'updateRoleConfig');
    const req: any = {
      method: 'GET',
      query: { packId: 'pack-1', roleId: 'planner' },
      body: {},
    };
    const res = mockRes();

    handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Allow', ['PATCH']);
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.end).toHaveBeenCalled();
    expect(updateRoleConfig).not.toHaveBeenCalled();
  });
});
