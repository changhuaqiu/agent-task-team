import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { executeSkillTool, resetRateLimit } from '@/server/skill-tool-executor';
import { readTasksMd } from '@/server/task-file-service';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GhCliGitProviderVerifier } from '@/server/engineering-collaboration/github-cli-verifier';
import { proofLogRepo } from '@/server/repositories/proof-log-repo';
import { teamPackRepo } from '@/server/repositories/team-pack-repo';
import { registerHarnessCoordinator } from '@/server/harness/registry';
import type { HarnessCoordinator } from '@/server/harness/coordinator';
import type { HarnessTrigger } from '@/server/harness/types';
import type { Server as IOServer } from 'socket.io';
import { AutonomousDeliveryRepository } from '@/server/autonomous-delivery/repository';
import type { GoalContract } from '@/server/autonomous-delivery/types';
import { observationSpanRepo } from '@/server/repositories/observation-span-repo';
import { spanPayloadRepo } from '@/server/repositories/span-payload-repo';

describe('skill tool collaboration gates', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    resetRateLimit('mario');
    resetRateLimit('luigi');
    conversationRepo.create({ id: 'conv-git', title: 'Git project', git_repo_root: 'C:/repo' });
    taskRepo.create({ id: 'TASK-GIT', conversation_id: 'conv-git', title: 'Ship safely', agent_id: 'luigi' });
    taskRepo.updateStatus('TASK-GIT', 'in_review');
  });

  it('cannot use a trusted agent identity to mutate a task from another conversation', async () => {
    conversationRepo.create({ id: 'conv-other', title: 'Other project', git_repo_root: 'C:/other' });
    const result = await executeSkillTool({
      toolName: 'collaboration_record_pr', agentId: 'luigi', conversationId: 'conv-other',
      input: {
        task_id: 'TASK-GIT', pull_request_url: 'https://github.com/acme/widget/pull/1',
        evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('does not belong to the invoking conversation');
  });

  it('cannot fabricate Git-backed done with caller-provided delivery strings', async () => {
    const result = await executeSkillTool({
      toolName: 'task_update_status', agentId: 'mario', conversationId: 'conv-git',
      input: {
        task_id: 'TASK-GIT', status: 'done', evidence: {
          mergedToMain: true, mainInstallResult: 'passed', mainBuildResult: 'passed',
          mainTestResult: 'passed', mainImpactReviewResult: 'passed',
        },
      },
    });

    expect(result).toMatchObject({ success: false });
    expect(result.error).toContain('mergeReceipt');
    expect(taskRepo.getById('TASK-GIT')?.status).toBe('in_review');
  });

  it('projects task mutations to the invocation runtime directory', async () => {
    const taskProjectDir = join(tmpdir(), `skill-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(taskProjectDir, { recursive: true });
    try {
      const result = await executeSkillTool({
        toolName: 'task_create', agentId: 'mario', conversationId: 'conv-git', taskProjectDir,
        input: { title: 'Runtime-scoped task' },
      });
      expect(result.success).toBe(true);
      expect(readTasksMd(taskProjectDir).tasks).toEqual([
        expect.objectContaining({ title: 'Runtime-scoped task', agent: 'mario', status: 'pending' }),
      ]);
    } finally {
      rmSync(taskProjectDir, { recursive: true, force: true });
    }
  });

  it('scopes operation budgets to one grant instead of the agent lifetime', async () => {
    const invoke = (rateLimitKey: string) => executeSkillTool({
      toolName: 'task_list', agentId: 'mario', conversationId: 'conv-git', rateLimitKey, input: {},
    });
    for (let index = 0; index < 10; index += 1) expect((await invoke('grant-a')).success).toBe(true);
    expect(await invoke('grant-a')).toMatchObject({ success: false, error: expect.stringContaining('Rate limit exceeded') });
    expect((await invoke('grant-b')).success).toBe(true);
  });

  it('returns committed receipt success when runtime projection needs reconciliation', async () => {
    taskRepo.updateStatus('TASK-GIT', 'in_progress');
    vi.spyOn(GhCliGitProviderVerifier.prototype, 'getPullRequest').mockResolvedValue({
      provider: 'github', repository: 'acme/widget', number: 1, title: 'Ship safely',
      url: 'https://github.com/acme/widget/pull/1', state: 'open', draft: false, author: 'luigi',
      baseRef: 'main', headRef: 'task/ship', headSha: 'a'.repeat(40), checks: 'passing',
      verifiedAt: '2026-07-18T00:00:00.000Z',
    });
    const invalidProjectPath = join(tmpdir(), `skill-runtime-file-${Date.now()}`);
    writeFileSync(invalidProjectPath, 'not a directory');
    try {
      const result = await executeSkillTool({
        toolName: 'collaboration_record_pr', agentId: 'luigi', conversationId: 'conv-git',
        taskProjectDir: invalidProjectPath,
        input: {
          task_id: 'TASK-GIT', pull_request_url: 'https://github.com/acme/widget/pull/1',
          evidence: { installResult: 'ok', buildResult: 'ok', testResult: 'ok', impactEvidence: 'ok' },
        },
      });

      expect(result.success).toBe(true);
      expect(taskRepo.getById('TASK-GIT')?.status).toBe('in_review');
      expect(proofLogRepo.findByType({
        eventType: 'task_graph.runtime_projection.failed', conversationId: 'conv-git', taskId: 'TASK-GIT',
        reasonCode: 'runtime_projection_failed',
      })).toHaveLength(1);
    } finally {
      rmSync(invalidProjectPath, { force: true });
      vi.restoreAllMocks();
    }
  });

  it('persists a structured reviewer REJECT and immediately dispatches the implementer', async () => {
    const pack = teamPackRepo.create({
      name: 'review-tool-team', displayName: 'Review tool team', description: '',
      roles: [
        { id: 'luigi', displayName: 'Developer', soul: '', required: true },
        { id: 'peach', displayName: 'Reviewer', soul: '', required: true, roleCardId: 'preset-code-reviewer' },
      ],
      teamMode: 'hub_spoke',
      workflow: {
        type: 'state_machine',
        states: [{ name: 'quality_gate', role: 'peach', description: 'Review gate', transitions: [] }],
      },
      communicationMatrix: {
        luigi: { canSendTo: ['peach'], canReceiveFrom: ['peach'] },
        peach: { canSendTo: ['luigi'], canReceiveFrom: ['luigi'] },
      },
    });
    conversationRepo.create({ id: 'conv-review-tool', title: 'Review project', team_pack_id: pack.id });
    const reviewRun = new AutonomousDeliveryRepository().createRun({
      goal: 'Review project', acceptanceCriteria: ['Reviewed'],
      scope: { conversationId: 'conv-review-tool', projectPath: process.cwd() },
      authorization: { allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false },
      recoveryPolicy: { maxAttemptsPerAction: 3, maxRepairCycles: 2, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    });
    taskRepo.create({ id: 'TASK-REVIEW', conversation_id: 'conv-review-tool', title: 'Review me', agent_id: 'luigi' });
    taskRepo.updateStatus('TASK-REVIEW', 'in_review');
    let submitted: HarnessTrigger | undefined;
    const io = { to: () => ({ emit: () => undefined }) } as unknown as IOServer;
    registerHarnessCoordinator(io, {
      submit(trigger: HarnessTrigger) {
        submitted = trigger;
        return { disposition: 'accepted', handled: true, completion: new Promise(() => undefined) };
      },
    } as unknown as HarnessCoordinator);

    const result = await executeSkillTool({
      toolName: 'task_update_status', agentId: 'peach', conversationId: 'conv-review-tool', io,
      deliveryRunId: reviewRun.run.id,
      input: {
        task_id: 'TASK-REVIEW', status: 'rejected', evidence: { reviewReceipt: {
          schemaVersion: 1,
          deliveryRunId: reviewRun.run.id,
          status: 'failed',
          reviewerAgentId: 'peach',
          summary: 'Eating moves two cells',
          evidenceRefs: ['src/game/engine.ts:121'],
          findings: [{
            severity: 'blocking', status: 'open', description: 'The second head bypasses collision checks',
            evidenceRefs: ['src/game/engine.ts:136'],
          }],
        } },
      },
    });

    expect(result.success).toBe(true);
    expect(taskRepo.getById('TASK-REVIEW')).toMatchObject({
      status: 'rejected',
      review_note: expect.stringContaining('REJECT: Eating moves two cells'),
    });
    expect(submitted).toMatchObject({
      taskId: 'TASK-REVIEW', agentId: 'luigi', contextScenario: 'code_review',
      wakeup: { reasonCode: 'review_rejected' },
    });
    expect(proofLogRepo.findByType({
      eventType: 'task_graph.review_decision.accepted',
      conversationId: 'conv-review-tool',
      taskId: 'TASK-REVIEW',
    })).toHaveLength(1);
  });

  it('rejects autonomous implementation evidence until install, build and test all exit normally', async () => {
    conversationRepo.create({ id: 'conv-exec-proof', title: 'Execution proof' });
    const task = taskRepo.create({
      id: 'TASK-EXEC-PROOF', conversation_id: 'conv-exec-proof', title: 'Build it', agent_id: 'luigi',
    });
    taskRepo.updateStatus(task.id, 'in_progress');
    const contract: GoalContract = {
      goal: 'Build it', acceptanceCriteria: ['Works'],
      scope: { conversationId: 'conv-exec-proof', projectPath: process.cwd() },
      authorization: { allowCodeChanges: true, allowPush: false, allowPullRequest: false, allowAutoMerge: false },
      recoveryPolicy: { maxAttemptsPerAction: 3, maxRepairCycles: 2, stallTimeoutMs: 60_000 },
      deliveryPolicy: { requireReview: true, requireWebE2E: false, requireMerge: false },
    };
    const run = new AutonomousDeliveryRepository().createRun(contract);
    const addCommand = (id: string, command: string, status: 'ok' | 'error') => {
      const span = observationSpanRepo.start({
        spanId: id, traceId: 'trace-exec-proof', name: 'tool.execute', kind: 'tool',
        conversationId: 'conv-exec-proof', taskId: task.id, agentId: 'luigi', invocationId: 'inv-proof',
        startedAt: new Date(Date.now() + Number(id.slice(-1))).toISOString(),
      });
      spanPayloadRepo.put(span.span_id, 'tool_input', { command });
      observationSpanRepo.finish(span.span_id, status, { outputPreview: status });
    };
    addCommand('span-install-1', 'npm install', 'ok');
    addCommand('span-build-2', 'npm run build', 'ok');
    addCommand('span-test-3', 'npm test', 'error');
    const evidence = { installResult: 'ok', buildResult: 'ok', testResult: '79 passed', impactEvidence: 'isolated' };

    const rejected = await executeSkillTool({
      toolName: 'task_update_status', agentId: 'luigi', conversationId: 'conv-exec-proof',
      deliveryRunId: run.run.id, input: { task_id: task.id, status: 'in_review', evidence },
    });
    expect(rejected).toMatchObject({ success: false, error: expect.stringContaining('test') });
    expect(taskRepo.getById(task.id)?.status).toBe('in_progress');

    addCommand('span-test-4', 'npx vitest run', 'ok');
    const accepted = await executeSkillTool({
      toolName: 'task_update_status', agentId: 'luigi', conversationId: 'conv-exec-proof',
      deliveryRunId: run.run.id, input: { task_id: task.id, status: 'in_review', evidence },
    });
    expect(accepted.success).toBe(true);
    expect(taskRepo.getById(task.id)?.status).toBe('in_review');
  });
});
