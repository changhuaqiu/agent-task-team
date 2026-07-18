import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { executeSkillTool, resetRateLimit } from '@/server/skill-tool-executor';

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
});
