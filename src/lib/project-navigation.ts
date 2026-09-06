import type { WorkItemIdentity } from './project-work-items';

export type ProjectTab = 'overview' | 'work' | 'reviews' | 'artifacts' | 'releases' | 'activity' | 'automations' | 'evaluation' | 'diagnostics';
export type WorkDetailTab = 'summary' | 'activity' | 'artifacts';
export interface ProjectNavigationTarget {
  projectId: string;
  tab: ProjectTab;
  work?: WorkItemIdentity;
  detailTab?: WorkDetailTab;
  messageId?: string;
  artifactId?: string;
  reviewId?: string;
}
const tabs: ProjectTab[] = ['overview', 'work', 'reviews', 'artifacts', 'releases', 'activity', 'automations', 'evaluation', 'diagnostics'];
const detailTabs: WorkDetailTab[] = ['summary', 'activity', 'artifacts'];

export function projectNavigationHash(target: ProjectNavigationTarget): string {
  const query = new URLSearchParams({ project: target.projectId, view: target.tab });
  if (target.work) { query.set('scope', target.work.conversationId); query.set('work', target.work.taskId); }
  if (target.detailTab) query.set('detail', target.detailTab);
  if (target.messageId) query.set('message', target.messageId);
  if (target.artifactId) query.set('artifact', target.artifactId);
  if (target.reviewId) query.set('review', target.reviewId);
  return '#' + query.toString();
}

export function parseProjectNavigationHash(hash: string): ProjectNavigationTarget | null {
  const query = new URLSearchParams(hash.replace(/^#/, ''));
  const projectId = query.get('project');
  const tab = query.get('view') as ProjectTab;
  if (!projectId || !tabs.includes(tab)) return null;
  const conversationId = query.get('scope'), taskId = query.get('work');
  if (Boolean(conversationId) !== Boolean(taskId)) return null;
  const detailTab = query.get('detail') as WorkDetailTab | null;
  if (detailTab && !detailTabs.includes(detailTab)) return null;
  return {
    projectId, tab,
    ...(conversationId && taskId ? { work: { conversationId, taskId } } : {}),
    ...(detailTab ? { detailTab } : {}),
    ...(query.get('message') ? { messageId: query.get('message')! } : {}),
    ...(query.get('artifact') ? { artifactId: query.get('artifact')! } : {}),
    ...(query.get('review') ? { reviewId: query.get('review')! } : {}),
  };
}
