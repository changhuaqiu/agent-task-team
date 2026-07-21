import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readGitHubIssueHookConfig } from './config';

describe('GitHub Issue hook configuration', () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = mkdtempSync(join(tmpdir(), 'github-issue-hook-config-'));
  });

  afterEach(() => {
    rmSync(projectPath, { recursive: true, force: true });
  });

  it('uses conservative defaults', () => {
    const config = readGitHubIssueHookConfig({
      GITHUB_ISSUE_WEBHOOK_SECRET: 'a-secure-test-secret-value',
      GITHUB_ISSUE_WEBHOOK_REPOSITORY: 'acme/widgets',
      GITHUB_ISSUE_WEBHOOK_PROJECT_PATH: projectPath,
    });
    expect(config.authorization).toEqual({
      allowPush: false,
      allowPullRequest: false,
      allowAutoMerge: false,
    });
    expect(config.deliveryPolicy).toEqual({
      requireReview: true,
      requireWebE2E: false,
      requireMerge: false,
    });
    expect(config.skipLabel).toBe('agent:skip');
    expect(config.trustedAssociations).toEqual(['OWNER', 'MEMBER', 'COLLABORATOR']);
  });

  it('rejects unsafe or inconsistent settings', () => {
    expect(() => readGitHubIssueHookConfig({
      GITHUB_ISSUE_WEBHOOK_SECRET: 'too-short',
      GITHUB_ISSUE_WEBHOOK_REPOSITORY: 'acme/widgets',
      GITHUB_ISSUE_WEBHOOK_PROJECT_PATH: projectPath,
    })).toThrow('at least 16 characters');

    expect(() => readGitHubIssueHookConfig({
      GITHUB_ISSUE_WEBHOOK_SECRET: 'a-secure-test-secret-value',
      GITHUB_ISSUE_WEBHOOK_REPOSITORY: 'acme/widgets',
      GITHUB_ISSUE_WEBHOOK_PROJECT_PATH: projectPath,
      GITHUB_ISSUE_ALLOW_AUTO_MERGE: 'true',
    })).toThrow('auto merge requires push and pull request authorization');
  });
});
