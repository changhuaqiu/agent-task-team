import type { ConversationRow } from './repositories/conversation-repo';

export interface ProjectExecutionConfig {
  useWorktree: boolean;
  gitRepoRoot?: string;
}

export function resolveProjectExecutionConfig(
  workspace: Pick<ConversationRow, 'use_worktree' | 'git_repo_root'>,
): ProjectExecutionConfig {
  const gitRepoRoot = workspace.git_repo_root?.trim();
  if (!workspace.use_worktree || !gitRepoRoot) return { useWorktree: false };
  return { useWorktree: true, gitRepoRoot };
}
