export type ProjectHealth = 'empty' | 'healthy' | 'attention' | 'blocked';

export interface ProjectStats {
  total: number;
  blocked: number;
  inProgress: number;
  done: number;
}

export function getProjectStatus(stats: ProjectStats): ProjectHealth {
  if (stats.total === 0) return 'empty';
  if (stats.blocked > 0) return 'blocked';
  if (stats.inProgress === 0 && stats.done === 0) return 'attention';
  return 'healthy';
}
