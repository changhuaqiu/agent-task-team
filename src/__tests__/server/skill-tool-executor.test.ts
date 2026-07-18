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
});
