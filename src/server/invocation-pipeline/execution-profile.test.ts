import { describe, expect, it } from 'vitest';
import { resolveExecutionProfile } from './execution-profile';

const skills = [
  { id: 'status', name: 'task-status-receipt' },
  { id: 'git', name: 'git-collaboration' },
  { id: 'browser', name: 'browser-verification' },
  { id: 'tasks', name: 'task-management' },
  { id: 'custom', name: 'domain-accounting' },
];

describe('resolveExecutionProfile', () => {
  it('activates browser verification from a Task strong signal without loading unrelated Git guidance', () => {
    const profile = resolveExecutionProfile({
      source: 'workflow',
      contextScenario: 'execution',
      prompt: 'continue',
      task: { title: '语音体验', description: '完成页面改动并提供浏览器实测记录' },
      skills,
    });

    expect(profile).toMatchObject({
      stage: 'implement',
      capabilities: expect.arrayContaining(['task_receipt', 'browser_verification']),
      missingRequiredSkillNames: [],
      exitPolicy: 'structured_outcome',
    });
    expect(profile.activatedSkills).toEqual(expect.arrayContaining([
      { skillId: 'status', reason: 'task' },
      { skillId: 'browser', reason: 'rule' },
      { skillId: 'custom', reason: 'agent_binding' },
    ]));
    expect(profile.activatedSkills).not.toContainEqual(expect.objectContaining({ skillId: 'git' }));
  });

  it('uses stage rules and explicit Skill references deterministically', () => {
    const profile = resolveExecutionProfile({
      source: 'workflow',
      contextScenario: 'planning',
      prompt: 'Plan this with $domain-accounting',
      skills,
    });

    expect(profile.stage).toBe('plan');
    expect(profile.activatedSkills).toEqual(expect.arrayContaining([
      { skillId: 'tasks', reason: 'rule' },
      { skillId: 'custom', reason: 'explicit' },
    ]));
    expect(profile.requiredSkillIds).toEqual(expect.arrayContaining(['tasks', 'custom']));
  });

  it('reports missing required browser Skill before dispatch', () => {
    const profile = resolveExecutionProfile({
      source: 'test_gate',
      prompt: 'verify',
      deliveryPolicy: { requireWebE2E: true },
      skills: [{ id: 'status', name: 'task-status-receipt' }],
    });

    expect(profile.stage).toBe('verify');
    expect(profile.missingRequiredSkillNames).toEqual(['browser-verification']);
    expect(profile.capabilities).not.toContain('browser_verification');
  });

  it('keeps outcome recovery free of implementation Skills and capabilities', () => {
    expect(resolveExecutionProfile({
      source: 'system',
      executionMode: 'outcome_recovery',
      contextScenario: 'recovery',
      prompt: 'recover',
      task: { title: 'browser task' },
      skills,
    })).toMatchObject({
      stage: 'recover',
      eligibleSkillIds: [],
      activatedSkills: [],
      requiredSkillIds: [],
      capabilities: [],
      exitPolicy: 'outcome_recovery',
    });
  });
});
