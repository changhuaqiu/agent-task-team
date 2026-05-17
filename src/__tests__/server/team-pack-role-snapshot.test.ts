import { describe, expect, it } from 'vitest';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';
import { PRESET_ROLE_CARDS } from '@/data/presetRoleCards';
import {
  materializeTeamRoleSnapshot,
  synthesizeRoleSnapshot,
} from '@/server/team-pack-role-snapshot';
import type { TeamPackRole } from '@/types/teamPack';

function role(overrides: Partial<TeamPackRole> & Pick<TeamPackRole, 'id' | 'displayName'>): TeamPackRole {
  return {
    soul: `# ${overrides.displayName}`,
    required: true,
    ...overrides,
  };
}

describe('team pack role snapshots', () => {
  it('synthesizes backend roles as implementation roles', () => {
    const snapshot = synthesizeRoleSnapshot(role({
      id: 'toad',
      displayName: '后端开发',
      description: '后端服务、API 开发、数据库',
    }));

    expect(snapshot.category).toBe('backend');
    expect(snapshot.allowedActions).toContain('can_modify_code');
    expect(snapshot.allowedActions).toContain('can_create_files');
    expect(snapshot.allowedActions).not.toContain('can_propose_only');
    expect(snapshot.forbiddenActions.join('')).not.toContain('修改代码');
  });

  it('keeps reviewer roles propose-only', () => {
    const snapshot = synthesizeRoleSnapshot(role({
      id: 'reviewer',
      displayName: '代码评审',
      description: '审查代码质量、发现问题',
    }));

    expect(snapshot.category).toBe('code_reviewer');
    expect(snapshot.allowedActions).toEqual(['can_propose_only']);
    expect(snapshot.forbiddenActions.join('')).toContain('直接修改代码');
  });

  it('binds default Toad role to the backend preset role card', () => {
    const defaultTeam = PRESET_TEAM_PACKS.find((pack) => pack.name === 'default-team');
    const toad = defaultTeam?.roles.find((item) => item.id === 'toad');

    expect(toad?.roleCardId).toBe('preset-backend');

    const materialized = materializeTeamRoleSnapshot(toad!, PRESET_ROLE_CARDS);
    expect(materialized.roleCardSnapshot?.sourceRoleCardId).toBe('preset-backend');
    expect(materialized.roleCardSnapshot?.allowedActions).toContain('can_modify_code');
    expect(materialized.roleCardSnapshot?.allowedActions).not.toContain('can_propose_only');
  });
});
