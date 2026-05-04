import type { Conversation } from '@/store/taskHubStore';

export function getWorkspaceName(conversations: Conversation[]): string {
  const path = conversations.find((c) => c.projectPath)?.projectPath;
  if (!path) return '工作区';
  const segments = path.replace(/\/$/, '').split('/');
  return segments[segments.length - 1] || '工作区';
}

export function getWorkspaceFullPath(conversations: Conversation[]): string | null {
  return conversations.find((c) => c.projectPath)?.projectPath ?? null;
}
