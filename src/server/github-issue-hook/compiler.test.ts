import { describe, expect, it } from 'vitest';
import { buildGoalTaskDescription } from '../autonomous-delivery/goal-task-description';
import {
  compileGitHubIssueGoalContract,
  extractIssueAcceptanceCriteria,
  parseGitHubIssuePayload,
} from './compiler';
import { githubIssueHookConfig, githubIssuePayload } from '@/test-helpers/github-issue-hook';

describe('GitHub Issue GoalContract compiler', () => {
  it('extracts unique unchecked Markdown checklist items', () => {
    expect(extractIssueAcceptanceCriteria([
      '- [ ] Verify signatures',
      '* [x] Already finished',
      '- [ ] verify signatures',
      '+ [ ] Preserve evidence',
    ].join('\n'))).toEqual([
      'Verify signatures',
      'Preserve evidence',
    ]);
  });

  it('compiles source context and conservative authorization', () => {
    const payload = githubIssuePayload();
    const contract = compileGitHubIssueGoalContract(
      payload,
      githubIssueHookConfig('C:\\workspace\\widgets'),
      'conversation-42',
    );

    expect(contract.goal).toBe('解决 GitHub Issue #42：Add automatic issue intake');
    expect(contract.acceptanceCriteria).toEqual([
      'Verify webhook signatures',
      'Avoid duplicate delivery runs',
      '保留与 acme/widgets#42 对应的实现、评审和验证证据',
    ]);
    expect(contract.source).toMatchObject({
      kind: 'github_issue',
      issueNumber: 42,
      repository: 'acme/widgets',
      sender: 'octocat',
    });
    expect(contract.authorization).toEqual({
      allowCodeChanges: true,
      allowPush: false,
      allowPullRequest: false,
      allowAutoMerge: false,
    });
    expect(buildGoalTaskDescription(contract)).toContain(payload.issue.html_url);
    expect(buildGoalTaskDescription(contract)).toContain('Create an automatic intake path.');
  });

  it('uses a deterministic fallback criterion when the issue has no checklist', () => {
    const payload = githubIssuePayload({
      issue: {
        ...githubIssuePayload().issue,
        body: 'The request has prose only.',
      },
    });
    const contract = compileGitHubIssueGoalContract(
      payload,
      githubIssueHookConfig('C:\\workspace\\widgets'),
      'conversation-42',
    );
    expect(contract.acceptanceCriteria[0]).toBe(
      '完成并验证 acme/widgets#42 描述的预期结果',
    );
  });

  it('rejects malformed payloads before business objects are created', () => {
    expect(() => parseGitHubIssuePayload({
      action: 'opened',
      repository: { full_name: 'acme/widgets' },
      issue: { number: '42' },
    })).toThrow('Invalid GitHub issues payload');
  });
});
