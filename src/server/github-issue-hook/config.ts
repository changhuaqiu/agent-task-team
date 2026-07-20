import { statSync } from 'node:fs';
import path from 'node:path';
import type { GitHubIssueHookConfig } from './types';

export class GitHubIssueHookConfigurationError extends Error {
  readonly code = 'configuration_invalid';
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new GitHubIssueHookConfigurationError(`${key} is required`);
  return value;
}

function booleanValue(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new GitHubIssueHookConfigurationError(`${key} must be true or false`);
}

function integerValue(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
): number {
  const value = env[key]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new GitHubIssueHookConfigurationError(`${key} must be an integer >= ${minimum}`);
  }
  return parsed;
}

export function readGitHubIssueHookConfig(
  env: NodeJS.ProcessEnv = process.env,
): GitHubIssueHookConfig {
  const secret = required(env, 'GITHUB_ISSUE_WEBHOOK_SECRET');
  if (secret.length < 16) {
    throw new GitHubIssueHookConfigurationError(
      'GITHUB_ISSUE_WEBHOOK_SECRET must contain at least 16 characters',
    );
  }

  const repository = required(env, 'GITHUB_ISSUE_WEBHOOK_REPOSITORY');
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new GitHubIssueHookConfigurationError(
      'GITHUB_ISSUE_WEBHOOK_REPOSITORY must use owner/repo format',
    );
  }

  const configuredPath = required(env, 'GITHUB_ISSUE_WEBHOOK_PROJECT_PATH');
  if (!path.isAbsolute(configuredPath)) {
    throw new GitHubIssueHookConfigurationError(
      'GITHUB_ISSUE_WEBHOOK_PROJECT_PATH must be absolute',
    );
  }
  let projectPath: string;
  try {
    projectPath = path.resolve(configuredPath);
    if (!statSync(projectPath).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new GitHubIssueHookConfigurationError(
      'GITHUB_ISSUE_WEBHOOK_PROJECT_PATH must reference an existing directory',
    );
  }

  const allowPush = booleanValue(env, 'GITHUB_ISSUE_ALLOW_PUSH', false);
  const allowPullRequest = booleanValue(env, 'GITHUB_ISSUE_ALLOW_PULL_REQUEST', false);
  const allowAutoMerge = booleanValue(env, 'GITHUB_ISSUE_ALLOW_AUTO_MERGE', false);
  const requireMerge = booleanValue(env, 'GITHUB_ISSUE_REQUIRE_MERGE', false);
  if (allowAutoMerge && (!allowPush || !allowPullRequest)) {
    throw new GitHubIssueHookConfigurationError(
      'auto merge requires push and pull request authorization',
    );
  }
  if (requireMerge && !allowAutoMerge) {
    throw new GitHubIssueHookConfigurationError(
      'required merge needs GITHUB_ISSUE_ALLOW_AUTO_MERGE=true',
    );
  }

  return {
    secret,
    repository,
    projectPath,
    teamPackId: env.GITHUB_ISSUE_WEBHOOK_TEAM_PACK_ID?.trim() || undefined,
    triggerLabel: env.GITHUB_ISSUE_WEBHOOK_TRIGGER_LABEL?.trim() || undefined,
    skipLabel: env.GITHUB_ISSUE_WEBHOOK_SKIP_LABEL?.trim() || 'agent:skip',
    trustedAssociations: (
      env.GITHUB_ISSUE_TRUSTED_ASSOCIATIONS?.split(',')
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
      ?? ['OWNER', 'MEMBER', 'COLLABORATOR']
    ),
    authorization: {
      allowPush,
      allowPullRequest,
      allowAutoMerge,
    },
    recoveryPolicy: {
      maxAttemptsPerAction: integerValue(env, 'GITHUB_ISSUE_MAX_ATTEMPTS', 3, 1),
      maxRepairCycles: integerValue(env, 'GITHUB_ISSUE_MAX_REPAIR_CYCLES', 2, 0),
      stallTimeoutMs: integerValue(env, 'GITHUB_ISSUE_STALL_TIMEOUT_MS', 900_000, 1_000),
    },
    deliveryPolicy: {
      requireReview: booleanValue(env, 'GITHUB_ISSUE_REQUIRE_REVIEW', true),
      requireWebE2E: booleanValue(env, 'GITHUB_ISSUE_REQUIRE_WEB_E2E', false),
      requireMerge,
    },
  };
}
