import { describe, expect, it } from 'vitest';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

function defaultTeam() {
  const pack = PRESET_TEAM_PACKS.find((item) => item.name === 'default-team');
  if (!pack) throw new Error('default-team preset is missing');
  return pack;
}

describe('default team collaboration template', () => {
  it('keeps the four platform roles required and first-class', () => {
    const pack = defaultTeam();

    expect(pack.roles.map((role) => role.id)).toEqual([
      'mario',
      'luigi',
      'peach',
      'dk',
    ]);
    expect(pack.roles.every((role) => role.required)).toBe(true);
  });

  it('uses Harness stages instead of a role-by-role serial flow', () => {
    const states = defaultTeam().workflow.states ?? [];

    expect(new Set(states.map((state) => state.role).filter(Boolean))).toEqual(new Set(['mario', 'luigi', 'peach']));
    expect(states.map((state) => state.name)).toEqual([
      'planning',
      'implementing',
      'quality_gate',
      'merge_verify',
      'done',
    ]);
    expect(states.find((state) => state.name === 'implementing')?.description).toContain('全栈实现');
    expect(states.find((state) => state.name === 'quality_gate')?.description).toContain('DK');
    expect(states.find((state) => state.name === 'merge_verify')?.description).toContain('main');
  });

  it('allows critical Harness responsibility paths without making every path open', () => {
    const matrix = defaultTeam().communicationMatrix;

    expect(matrix.luigi.canSendTo).toContain('peach');
    expect(matrix.peach.canSendTo).toEqual(expect.arrayContaining(['mario', 'luigi', 'dk']));
    expect(matrix.dk.canSendTo).toEqual(expect.arrayContaining(['mario', 'luigi', 'peach']));
    expect(matrix.luigi.canSendTo).not.toContain('dk');
  });

  it('keeps every communication target inside the four-role roster', () => {
    const pack = defaultTeam();
    const roleIds = new Set(pack.roles.map((role) => role.id));
    for (const [roleId, rule] of Object.entries(pack.communicationMatrix)) {
      expect(roleIds.has(roleId)).toBe(true);
      for (const target of [...rule.canSendTo, ...rule.canReceiveFrom]) {
        expect(roleIds.has(target)).toBe(true);
      }
    }
  });

  it('requires repository impact evidence in each default role prompt', () => {
    const roles = defaultTeam().roles;

    for (const role of roles) {
      expect(role.soul).toContain('Repository Impact Analysis Protocol');
      expect(role.soul).toContain('impact evidence');
    }

    expect(roles.find((role) => role.id === 'mario')?.soul).toContain('流程、模块边界、调用链和依赖');
    expect(roles.find((role) => role.id === 'luigi')?.soul).toContain('仓库搜索、调用链和相关测试');
    expect(roles.find((role) => role.id === 'peach')?.soul).toContain('变更差异、调用链和相关测试');
    expect(roles.find((role) => role.id === 'dk')?.soul).toContain('模块关系、关键流程、调用上下文和影响范围');
  });

  it('teaches personality-led autonomy and dispatch receipt closure', () => {
    const roles = defaultTeam().roles;

    for (const role of roles) {
      expect(role.soul).toContain('人格自治闭环');
      expect(role.soul).toContain('真实 dispatch receipt');
      expect(role.soul).toContain('n/n dispatched');
      expect(role.soul).toContain('不要说“无待办”');
    }

    expect(roles.find((role) => role.id === 'mario')?.soul).toContain('宣布“管道已启动”前');
    expect(roles.find((role) => role.id === 'peach')?.soul).toContain('collaboration_record_review');
  });
});
