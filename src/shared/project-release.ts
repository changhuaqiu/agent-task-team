import { buildObjectReference } from './object-reference';

export type ProjectReleaseStatus = 'draft' | 'published';
export type ProjectReleaseTargetType = 'work' | 'review';

export interface ProjectReleaseTarget {
  type: ProjectReleaseTargetType;
  id: string;
}

export interface ProjectRelease {
  id: string;
  projectId: string;
  name: string;
  description: string;
  status: ProjectReleaseStatus;
  targets: ProjectReleaseTarget[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
  reference: string;
}

export function releaseReference(projectId: string, releaseId: string): string {
  return buildObjectReference({ kind: 'release', projectId, objectId: releaseId });
}
