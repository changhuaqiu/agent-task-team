import { describe, expect, it } from 'vitest';
import { PRESET_TEAM_PACKS } from '@/data/presetTeamPacks';

function defaultTeam() {
  const pack = PRESET_TEAM_PACKS.find((item) => item.name === 'default-team');
  if (!pack) throw new Error('default-team preset is missing');
  return pack;
}

describe('default team collaboration template', () => {
  it('keeps all six sample roles required and first-class', () => {
    const pack = defaultTeam();

    expect(pack.roles.map((role) => role.id)).toEqual([
      'mario',
      'luigi',
      'toad',
      'peach',
      'dk',
      'yoshi',
    ]);
    expect(pack.roles.every((role) => role.required)).toBe(true);
  });

  it('uses Harness stages instead of a fake six-role serial flow', () => {
    const states = defaultTeam().workflow.states ?? [];

    expect(states.map((state) => state.role).filter(Boolean)).toEqual([
      'mario',
      'luigi',
      'peach',
      'yoshi',
    ]);
    expect(states.map((state) => state.name)).toEqual([
      'planning',
      'implementing',
      'review_gate',
      'test_gate',
      'done',
    ]);
    expect(states.find((state) => state.name === 'implementing')?.description).toContain('Toad');
    expect(states.find((state) => state.name === 'review_gate')?.description).toContain('DK');
  });

  it('allows critical Harness responsibility paths without making every path open', () => {
    const matrix = defaultTeam().communicationMatrix;

    expect(matrix.luigi.canSendTo).toContain('toad');
    expect(matrix.toad.canSendTo).toContain('luigi');
    expect(matrix.luigi.canSendTo).toContain('peach');
    expect(matrix.toad.canSendTo).toContain('peach');
    expect(matrix.peach.canSendTo).toEqual(expect.arrayContaining(['luigi', 'toad', 'dk', 'yoshi']));
    expect(matrix.yoshi.canSendTo).toEqual(expect.arrayContaining(['luigi', 'toad', 'peach', 'dk']));
    expect(matrix.dk.canSendTo).toEqual(expect.arrayContaining(['luigi', 'toad', 'peach']));
    expect(matrix.dk.canSendTo).not.toContain('yoshi');
    expect(matrix.luigi.canSendTo).not.toContain('dk');
  });

  it('requires graph-first GitNexus evidence in each default role prompt', () => {
    const roles = defaultTeam().roles;

    for (const role of roles) {
      expect(role.soul).toContain('GitNexus Graph-First Protocol');
      expect(role.soul).toContain('GitNexus evidence');
    }

    expect(roles.find((role) => role.id === 'mario')?.soul).toContain('flows、clusters、模块边界');
    expect(roles.find((role) => role.id === 'luigi')?.soul).toContain('context/impact 查目标组件');
    expect(roles.find((role) => role.id === 'toad')?.soul).toContain('API、数据模型、服务调用链');
    expect(roles.find((role) => role.id === 'peach')?.soul).toContain('impact 或 detect_changes');
    expect(roles.find((role) => role.id === 'dk')?.soul).toContain('clusters、processes、context 或 impact');
    expect(roles.find((role) => role.id === 'yoshi')?.soul).toContain('affected processes、入口点');
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
    expect(roles.find((role) => role.id === 'peach')?.soul).toContain('test_gate 已形成结构化唤醒');
  });
});
