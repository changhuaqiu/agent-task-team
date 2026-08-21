// Invocation Pipeline context planner tests.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb, getDb, resetDb, setTestDb } from '@/server/db';
import { seedPresetAgents } from '@/server/db/seed-agents';
import { seedTeamPacks } from '@/server/seed-team-packs';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { messageRepo } from '@/server/repositories/message-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { sessionRepo } from '@/server/repositories/session-repo';
import { writeAccount } from '@/server/accounts-file';
import { InvocationPlanner } from '@/server/invocation-pipeline/context-planner';
import { skillRepo } from '@/server/repositories/skill-repo';
import { RepositorySkillRuntime } from '@/server/skills/skill-runtime';
import { buildSkillPackageInput } from '@/test-helpers/skill-package';
import { InvocationCoordinator } from '@/server/invocation-pipeline/coordinator';
import { projectObservationProjection } from '@/server/observability/ProjectObservationProjection';
import { autonomousDeliveryRepo } from '@/server/autonomous-delivery/repository';
import { seedPresetSkills } from '@/server/seed-skills';

let dataDir: string;
let previousDataDir: string | undefined;

beforeEach(() => {
  setTestDb(createTestDb());
  seedPresetAgents();
  seedTeamPacks();
  previousDataDir = process.env.ATH_DATA_DIR;
  dataDir = mkdtempSync(join(tmpdir(), 'ath-harness-'));
  process.env.ATH_DATA_DIR = dataDir;
  seedPresetSkills();
});
afterEach(() => {
  resetDb();
  rmSync(dataDir, { recursive: true, force: true });
  if (previousDataDir === undefined) delete process.env.ATH_DATA_DIR;
  else process.env.ATH_DATA_DIR = previousDataDir;
});

describe('InvocationPlanner', () => {
  it('blocks a task that belongs to another project before context assembly', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    conversationRepo.create({ id: 'conv-scope-a', title: 'Scope A', team_pack_id: pack.id });
    conversationRepo.create({ id: 'conv-scope-b', title: 'Scope B', team_pack_id: pack.id });
    taskRepo.create({
      id: 'TASK-SCOPE-B',
      conversation_id: 'conv-scope-b',
      title: 'Private task from B',
      description: 'must never enter project A context',
      agent_id: 'luigi',
    });

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-cross-project',
      source: 'workflow',
      conversationId: 'conv-scope-a',
      taskId: 'TASK-SCOPE-B',
      agentId: 'luigi',
      prompt: 'continue',
    });

    expect(result).toEqual({
      ok: false,
      outcome: { status: 'blocked', reasonCode: 'task_scope_mismatch' },
    });
  });

  it('bootstraps identity for a first A2A handoff and keeps later handoffs lean', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'peach', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai',
      name: 'OpenAI',
      authMode: 'oauth',
      provider: 'openai',
      models: [],
      enabled: true,
      status: 'valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-a2a', title: 'First Handoff', team_pack_id: pack.id });

    const first = await new InvocationPlanner().prepare({
      id: 'trigger-a2a-first',
      source: 'a2a',
      conversationId: 'conv-a2a',
      agentId: 'peach',
      fromAgentId: 'mario',
      prompt: '请评审 PR #32 的代码质量',
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.plan.contextScenario).toBe('init');
    expect(first.plan.systemPrompt).toContain('Peach');
    expect(first.plan.prompt).toContain('A2A');
    expect(first.plan.workContract).toMatchObject({
      workEpoch: 1,
      agentId: 'peach',
      projectId: 'conv-a2a',
      contextSnapshotRef: first.plan.contextSnapshot?.id,
      allowedOutcomeTypes: expect.arrayContaining([
        'handoff_to_agent',
        'submit_task_result',
      ]),
      correlationId: first.plan.traceId,
      causationId: 'trigger-a2a-first',
    });
    expect(first.plan.prompt).toContain('请评审 PR #32');

    sessionRepo.create({ id: 'session-peach', conversationId: 'conv-a2a', agentId: 'peach', taskId: '' });
    const later = await new InvocationPlanner().prepare({
      id: 'trigger-a2a-later',
      source: 'a2a',
      conversationId: 'conv-a2a',
      agentId: 'peach',
      fromAgentId: 'mario',
      prompt: '请复核修复结果',
    });
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.plan.contextScenario).toBe('handoff');
    expect(later.plan.systemPrompt).toBeUndefined();
    expect(later.plan.prompt).toContain('请复核修复结果');
  });

  it('resolves role, account, context and project data on the server', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'luigi', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai',
      name: 'OpenAI',
      authMode: 'oauth',
      provider: 'openai',
      models: [],
      enabled: true,
      status: 'valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const projectRoot = join(dataDir, 'harness-project');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'harness-project',
      scripts: { test: 'vitest run' },
    }), 'utf8');
    conversationRepo.create({
      id: 'conv-1',
      title: 'Harness Project',
      team_pack_id: pack.id,
      project_path: projectRoot,
    });
    taskRepo.create({
      id: 'TASK-1',
      conversation_id: 'conv-1',
      title: 'Implement server loop',
      description: 'Move continuation to the server',
      agent_id: 'luigi',
    });
    const teamLogEntryId = messageRepo.append({
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      senderType: 'agent',
      senderId: 'peach',
      content: 'TASK-1 评审已通过，可以继续实现',
      mentions: ['luigi'],
      intent: 'review',
    });

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-1',
      source: 'workflow',
      conversationId: 'conv-1',
      taskId: 'TASK-1',
      agentId: 'luigi',
      prompt: 'Start TASK-1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan).toMatchObject({
      engine: 'codex',
      accountId: 'account-openai',
      runtimeId: 'codex-cli',
      projectPath: projectRoot,
      contextScenario: 'wakeup',
      teamLogUpToEntryId: teamLogEntryId,
    });
    expect(result.plan.prompt).toContain('TASK-1');
    expect(result.plan.prompt).toContain('系统唤醒');
    expect(result.plan.prompt).toContain('团队动态');
    expect(result.plan.prompt).toContain('## 项目上下文入口');
    expect(result.plan.contextSnapshot?.fragmentRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ producer: 'project-context', version: expect.stringMatching(/^r1:/) }),
    ]));
    expect(result.plan.systemPrompt).toBeUndefined();
  });

  it('injects the active DeliveryRun through the production Context Contributor', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'mario', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai',
      name: 'OpenAI',
      authMode: 'oauth',
      provider: 'openai',
      models: [],
      enabled: true,
      status: 'valid',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const projectRoot = join(dataDir, 'delivery-context');
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({
      name: 'delivery-context',
      scripts: { test: 'vitest run' },
    }), 'utf8');
    conversationRepo.create({
      id: 'conv-delivery-context',
      title: 'Delivery Context',
      team_pack_id: pack.id,
      project_path: projectRoot,
    });
    const delivery = autonomousDeliveryRepo.createRun({
      idempotencyKey: 'context-planner-active-delivery',
      goal: '完成真实 Team Harness',
      acceptanceCriteria: ['Context Snapshot 可追溯', '必须通过 Web UI E2E'],
      scope: { conversationId: 'conv-delivery-context', projectPath: projectRoot },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 3,
        maxRepairCycles: 2,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: true,
        requireMerge: false,
      },
    });

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-delivery-context',
      source: 'workflow',
      conversationId: 'conv-delivery-context',
      agentId: 'mario',
      prompt: '开始规划',
      contextScenario: 'planning',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.contextScenario).toBe('planning');
    expect(result.plan.prompt).toContain('## 自主交付目标');
    expect(result.plan.prompt).toContain('完成真实 Team Harness');
    expect(result.plan.prompt).toContain('必须通过 Web UI E2E');
    expect(result.plan.prompt).toContain('## 自主交付约束');
    expect(result.plan.contextSnapshot?.fragmentRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `delivery-goal:${delivery.run.id}`,
        producer: 'autonomous-delivery',
      }),
    ]));
    expect(result.plan.contextReport.snapshotId).toBe(result.plan.contextSnapshot?.id);

    const missing = await new InvocationPlanner().prepare({
      id: 'trigger-delivery-context-missing',
      source: 'workflow',
      conversationId: 'conv-delivery-context',
      agentId: 'mario',
      prompt: '继续执行',
      contextScenario: 'execution',
      deliveryRunId: 'delivery-missing',
    });
    expect(missing).toMatchObject({
      ok: false,
      outcome: {
        status: 'failed',
        reasonCode: 'required_context_missing',
      },
    });
    const observation = projectObservationProjection.build('conv-delivery-context', 10);
    expect(observation.traces).toContainEqual(expect.objectContaining({
      status: 'error',
      context: expect.objectContaining({
        scenario: 'execution',
        missingRequired: ['contributor:autonomous-delivery'],
        snapshotId: expect.stringMatching(/^ctx_failed_/),
      }),
    }));
  });

  it('blocks with a stable reason when the role has no enabled runtime profile', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    conversationRepo.create({ id: 'conv-2', title: 'No Runtime', team_pack_id: pack.id });

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-2',
      source: 'system',
      conversationId: 'conv-2',
      agentId: 'luigi',
      prompt: 'Continue',
    });

    expect(result).toEqual({
      ok: false,
      outcome: { status: 'blocked', reasonCode: 'runtime_profile_missing' },
    });
  });

  it('compiles an assigned Skill revision into the dispatch context with evidence', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'luigi', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-skill', title: 'Skill Dispatch', team_pack_id: pack.id });
    const revision = await new RepositorySkillRuntime().install(buildSkillPackageInput({
      name: 'review-safely', description: 'Review changes safely', content: 'Always inspect the diff before approval.',
      files: [{ path: 'references/checklist.md', content: 'Long checklist stays on demand.' }],
    }));
    skillRepo.assignToAgent('luigi', revision.skillId);

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-skill', source: 'user', conversationId: 'conv-skill', agentId: 'luigi', prompt: 'Review this change',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(`${result.plan.systemPrompt ?? ''}\n${result.plan.prompt}`).toContain('Always inspect the diff before approval.');
    expect(result.plan.prompt).toContain('checklist.md');
    expect(result.plan.prompt).not.toContain('Long checklist stays on demand.');
    expect(result.plan.contextReport.skillDecisions.find((decision) => decision.skillId === revision.skillId)).toMatchObject({
      skillId: revision.skillId, revision: revision.revision, contentHash: revision.contentHash, outcome: 'loaded',
    });
  });

  it('advertises only registered collaboration tools declared by an assigned Skill', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'luigi', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-collab-tool', title: 'Collaboration Tool', team_pack_id: pack.id });
    const revision = await new RepositorySkillRuntime().install(buildSkillPackageInput({
      name: 'collaboration-tools', description: 'Provider receipts', content: 'Use the exact platform tool.', files: [],
      config: JSON.stringify({ tools: [{
        name: 'collaboration_record_pr', description: 'Record PR', handler: 'api://collaboration/pull-request',
        parameters: [{ name: 'task_id', type: 'string', required: true, description: 'Task ID' }],
      }] }),
    }));
    skillRepo.assignToAgent('luigi', revision.skillId);

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-collab-tool', source: 'user', conversationId: 'conv-collab-tool', agentId: 'luigi', prompt: 'Submit PR',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.contextReport.availableTools).toContain('collaboration_record_pr');
    expect(`${result.plan.systemPrompt ?? ''}\n${result.plan.prompt}`).toContain('collaboration_record_pr');
  });

  it('routes a browser-evidence Task to browser verification without loading unrelated Git guidance', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'luigi', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-browser-rule', title: 'Browser Rule', team_pack_id: pack.id });
    taskRepo.create({
      id: 'TASK-BROWSER',
      conversation_id: 'conv-browser-rule',
      title: '语音体验改进',
      description: '完成 app.js 改动、npm run check 和浏览器实测记录',
      agent_id: 'luigi',
    });

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-browser-rule',
      source: 'workflow',
      conversationId: 'conv-browser-rule',
      taskId: 'TASK-BROWSER',
      agentId: 'luigi',
      contextScenario: 'execution',
      prompt: '继续完成任务',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executionProfile).toMatchObject({
      stage: 'implement',
      capabilities: expect.arrayContaining(['task_receipt', 'browser_verification']),
      missingRequiredSkillNames: [],
    });
    expect(result.plan.contextReport.loadedSkills).toEqual(expect.arrayContaining([
      'task-status-receipt',
      'browser-verification',
    ]));
    expect(result.plan.contextReport.loadedSkills).not.toContain('git-collaboration');
    expect(result.plan.contextReport.skillDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'git-collaboration',
        outcome: 'omitted',
        reasonCode: 'not_activated_for_execution_profile',
      }),
    ]));
    expect(result.plan.workContract.permissions).toMatchObject({
      executionProfile: {
        capabilities: expect.arrayContaining(['browser_verification']),
      },
    });
  });

  it('routes every activation source through required-Skill validation', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'peach', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-socket-skill', title: 'Socket Skill Guard', team_pack_id: pack.id });
    const revision = await new RepositorySkillRuntime().install(buildSkillPackageInput({
      name: 'required-guard', description: 'Required guard', content: 'Validate before dispatch.', files: [],
    }));
    skillRepo.assignToAgent('peach', revision.skillId);
    writeFileSync(join(revision.packagePath, 'SKILL.md'), 'tampered', 'utf8');
    const execute = vi.fn();
    const coordinator = new InvocationCoordinator({
      planner: new InvocationPlanner(),
      runtime: { isBusy: () => false, execute },
      recordProof: vi.fn(),
    });

    for (const source of ['user', 'workflow', 'review_gate', 'a2a'] as const) {
      const submission = coordinator.submit({
        id: `activation-${source}`,
        conversationId: 'conv-socket-skill',
        agentId: 'peach',
        prompt: `dispatch ${source}`,
        source,
      });
      await expect(submission.completion).resolves.toMatchObject({
        status: 'failed',
        reasonCode: 'skill_manifest_invalid',
      });
    }
    expect(execute).not.toHaveBeenCalled();
    const snapshot = projectObservationProjection.build('conv-socket-skill', 10);
    expect(snapshot.traces).toHaveLength(4);
    expect(snapshot.traces.every((trace) => trace.status === 'error')).toBe(true);
    expect(snapshot.traces[0].context?.skillDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: revision.skillId, outcome: 'failed', reasonCode: 'skill_manifest_invalid' }),
    ]));
  });

  it('routes a legacy proposal through Coordinator and Planner admission', async () => {
    conversationRepo.create({ id: 'conv-external-autonomous', title: 'External autonomous run' });
    autonomousDeliveryRepo.createRun({
      idempotencyKey: 'external-autonomous-run',
      goal: 'Deliver from another tab',
      acceptanceCriteria: ['Planning has one authority'],
      scope: { conversationId: 'conv-external-autonomous', projectPath: 'C:/fixture' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 3,
        maxRepairCycles: 2,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: true,
        requireWebE2E: true,
        requireMerge: false,
      },
    });
    const execute = vi.fn();
    const recordProof = vi.fn();
    const coordinator = new InvocationCoordinator({
      planner: new InvocationPlanner(),
      runtime: { isBusy: () => false, execute },
      recordProof,
    });

    const submission = coordinator.submit({
      id: 'legacy-proposal',
      conversationId: 'conv-external-autonomous',
      agentId: 'mario',
      prompt: 'Generate the legacy proposal',
      source: 'user',
      legacyProposal: true,
    });

    await expect(submission.completion).resolves.toEqual({
      status: 'blocked',
      reasonCode: 'autonomous_delivery_owns_planning',
    });
    expect(submission.disposition).toBe('accepted');
    expect(execute).not.toHaveBeenCalled();
    expect(recordProof).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'invocation.plan.blocked',
      reasonCode: 'autonomous_delivery_owns_planning',
    }));
  });

  it('executes a legacy proposal for an ordinary project through Coordinator and Planner', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'mario', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-no-delivery-run', title: 'Ordinary proposal', team_pack_id: pack.id });
    const execute = vi.fn().mockResolvedValue({ status: 'accepted' as const, envelopeId: 'env-proposal' });
    const coordinator = new InvocationCoordinator({
      planner: new InvocationPlanner(),
      runtime: { isBusy: () => false, execute },
      recordProof: vi.fn(),
    });

    const submission = coordinator.submit({
      id: 'legacy-proposal',
      conversationId: 'conv-no-delivery-run',
      agentId: 'mario',
      prompt: 'Generate a proposal',
      source: 'user',
      legacyProposal: true,
    });

    await expect(submission.completion).resolves.toEqual({ status: 'accepted', envelopeId: 'env-proposal' });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.objectContaining({ legacyProposal: true }),
    }));
  });

  it('observes an invalid legacy Skill file path as a bounded Skill failure', async () => {
    const pack = teamPackRepo.getByName('default-team')!;
    teamPackRepo.updateRoleConfig(pack.id, 'peach', { accountIds: ['account-openai'] });
    writeAccount({
      id: 'account-openai', name: 'OpenAI', authMode: 'oauth', provider: 'openai', models: [],
      enabled: true, status: 'valid', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    conversationRepo.create({ id: 'conv-legacy-path', title: 'Legacy path guard', team_pack_id: pack.id });
    const skill = skillRepo.create({ name: 'Legacy Review', description: 'Legacy review', content: 'Review safely.' });
    getDb().prepare('INSERT INTO skill_file (id, skill_id, path, content) VALUES (?, ?, ?, ?)')
      .run('sf-legacy-invalid', skill.id, 'C:\\secret.md', 'must not load');
    skillRepo.assignToAgent('peach', skill.id);

    const result = await new InvocationPlanner().prepare({
      id: 'trigger-legacy-path', source: 'user', conversationId: 'conv-legacy-path', agentId: 'peach', prompt: 'Review',
    });

    expect(result).toMatchObject({ ok: false, outcome: { status: 'failed', reasonCode: 'skill_path_invalid' } });
    const snapshot = projectObservationProjection.build('conv-legacy-path', 10);
    expect(snapshot.traces).toHaveLength(1);
    expect(snapshot.traces[0]).toMatchObject({ status: 'error' });
    expect(snapshot.traces[0].context?.skillDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ skillId: skill.id, outcome: 'failed', reasonCode: 'skill_path_invalid' }),
    ]));
  });
});
