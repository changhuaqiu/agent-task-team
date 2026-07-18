import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, setTestDb } from '@/server/db';
import { conversationRepo } from '@/server/repositories/conversation-repo';
import { taskRepo } from '@/server/repositories/task-repo';
import { executeSkillTool, resetRateLimit } from '@/server/skill-tool-executor';

describe('skill tool collaboration gates', () => {
  beforeEach(() => {
    setTestDb(createTestDb());
    resetRateLimit('mario');
    conversationRepo.create({ id: 'conv-git', title: 'Git project', git_repo_root: 'C:/repo' });
    taskRepo.create({ id: 'TASK-GIT', conversation_id: 'conv-git', title: 'Ship safely', agent_id: 'luigi' });
    taskRepo.updateStatus('TASK-GIT', 'in_review');
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
