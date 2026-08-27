import { getDb } from '../db';
import { buildObjectReference } from '@/shared/object-reference';
import type { ProjectReview, ProjectReviewStatus } from '@/shared/project-review';

export interface ProjectReviewRow {
  id: string;
  project_id: string;
  repository_root: string;
  base_ref: string;
  compare_ref: string;
  title: string;
  description: string;
  status: ProjectReviewStatus;
  decision_summary: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

function normalizeRef(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error(`review_${label}_invalid`);
  }
  return normalized;
}

function normalizeRoot(value: string): string {
  const normalized = value.trim().replace(/[\\/]+$/, '');
  if (!normalized) throw new Error('review_repository_required');
  return normalized;
}

export function projectReviewFromRow(row: ProjectReviewRow): ProjectReview {
  return {
    id: row.id,
    projectId: row.project_id,
    repositoryRoot: row.repository_root,
    baseRef: row.base_ref,
    compareRef: row.compare_ref,
    title: row.title,
    description: row.description,
    status: row.status,
    ...(row.decision_summary ? { decisionSummary: row.decision_summary } : {}),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reference: buildObjectReference({ kind: 'review', projectId: row.project_id, objectId: row.id }),
  };
}

export const projectReviewRepo = {
  listAll(): ProjectReviewRow[] {
    return getDb().prepare(`
      SELECT * FROM project_review
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END,
               updated_at DESC,id DESC
    `).all() as ProjectReviewRow[];
  },

  list(projectId: string): ProjectReviewRow[] {
    return getDb().prepare(`
      SELECT * FROM project_review WHERE project_id=?
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'changes_requested' THEN 1 ELSE 2 END,
               updated_at DESC,id DESC
    `).all(projectId) as ProjectReviewRow[];
  },

  getById(id: string): ProjectReviewRow | undefined {
    return getDb().prepare('SELECT * FROM project_review WHERE id=?').get(id) as ProjectReviewRow | undefined;
  },

  create(input: {
    id: string;
    projectId: string;
    repositoryRoot: string;
    baseRef: string;
    compareRef: string;
    title: string;
    description?: string;
  }): { row: ProjectReviewRow; created: boolean } {
    const existingById = projectReviewRepo.getById(input.id);
    const repositoryRoot = normalizeRoot(input.repositoryRoot);
    const baseRef = normalizeRef(input.baseRef, 'base_ref');
    const compareRef = normalizeRef(input.compareRef, 'compare_ref');
    const title = normalizeRef(input.title, 'title');
    const description = input.description?.trim() ?? '';
    if (baseRef === compareRef) throw new Error('review_branches_must_differ');
    const project = getDb().prepare('SELECT root_path FROM project WHERE id=?').get(input.projectId) as { root_path: string } | undefined;
    if (!project) throw new Error('review_project_not_found');
    if (normalizeRoot(project.root_path).toLocaleLowerCase() !== repositoryRoot.toLocaleLowerCase()) {
      throw new Error('review_repository_outside_project');
    }
    if (existingById) {
      const exact = existingById.project_id === input.projectId
        && existingById.repository_root.toLocaleLowerCase() === repositoryRoot.toLocaleLowerCase()
        && existingById.base_ref === baseRef
        && existingById.compare_ref === compareRef
        && existingById.title === title
        && existingById.description === description;
      if (!exact) throw new Error('review_idempotency_conflict');
      return { row: existingById, created: false };
    }
    const openPair = getDb().prepare(`
      SELECT id FROM project_review
      WHERE project_id=? AND repository_root=? COLLATE NOCASE AND base_ref=? AND compare_ref=?
        AND status IN ('open','changes_requested')
    `).get(input.projectId, repositoryRoot, baseRef, compareRef) as { id: string } | undefined;
    if (openPair) throw new Error('review_already_open');
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO project_review (
        id,project_id,repository_root,base_ref,compare_ref,title,description,status,revision,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,'open',1,?,?)
    `).run(input.id, input.projectId, repositoryRoot, baseRef, compareRef, title, description, now, now);
    return { row: projectReviewRepo.getById(input.id)!, created: true };
  },

  recordDecision(input: {
    id: string;
    expectedRevision: number;
    status: Extract<ProjectReviewStatus, 'changes_requested' | 'approved' | 'closed'>;
    summary: string;
  }): ProjectReviewRow {
    const summary = normalizeRef(input.summary, 'decision_summary');
    const current = projectReviewRepo.getById(input.id);
    if (!current) throw new Error('review_not_found');
    if (current.revision !== input.expectedRevision) throw new Error('review_revision_conflict');
    if (current.status !== 'open' && current.status !== 'changes_requested') throw new Error('review_not_decidable');
    const now = new Date().toISOString();
    const result = getDb().prepare(`
      UPDATE project_review
      SET status=?,decision_summary=?,revision=revision+1,updated_at=?
      WHERE id=? AND revision=?
    `).run(input.status, summary, now, input.id, input.expectedRevision);
    if (result.changes !== 1) throw new Error('review_revision_conflict');
    return projectReviewRepo.getById(input.id)!;
  },
};
