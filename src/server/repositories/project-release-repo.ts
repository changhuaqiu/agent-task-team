import { getDb } from '../db';
import { releaseReference, type ProjectRelease, type ProjectReleaseStatus, type ProjectReleaseTarget } from '@/shared/project-release';

interface ProjectReleaseRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: ProjectReleaseStatus;
  targets_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function targets(value: string): ProjectReleaseTarget[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error('release_targets_invalid');
  return parsed as ProjectReleaseTarget[];
}

export function projectReleaseFromRow(row: ProjectReleaseRow): ProjectRelease {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    status: row.status,
    targets: targets(row.targets_json),
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    reference: releaseReference(row.project_id, row.id),
  };
}

function normalizedTargets(projectId: string, input: ProjectReleaseTarget[]): ProjectReleaseTarget[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('release_targets_required');
  const seen = new Set<string>();
  const output = input.map((target) => {
    if (!target || !['work', 'review'].includes(target.type) || typeof target.id !== 'string' || !target.id.trim()) {
      throw new Error('release_target_invalid');
    }
    const normalized = { type: target.type, id: target.id.trim() } as ProjectReleaseTarget;
    const key = `${normalized.type}:${normalized.id}`;
    if (seen.has(key)) throw new Error('release_target_duplicate');
    seen.add(key);
    if (normalized.type === 'work') {
      const work = getDb().prepare(`
        SELECT task.id FROM task
        JOIN conversation ON conversation.id=task.conversation_id
        WHERE task.id=? AND conversation.project_id=?
      `).get(normalized.id, projectId);
      if (!work) throw new Error('release_target_outside_project');
    } else {
      const review = getDb().prepare('SELECT id FROM project_review WHERE id=? AND project_id=?')
        .get(normalized.id, projectId);
      if (!review) throw new Error('release_target_outside_project');
    }
    return normalized;
  });
  return output.sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

function assertReady(release: ProjectRelease): void {
  for (const target of release.targets) {
    if (target.type === 'work') {
      const row = getDb().prepare('SELECT status FROM task WHERE id=?').get(target.id) as { status: string } | undefined;
      if (row?.status !== 'done') throw new Error('release_work_not_done');
    } else {
      const row = getDb().prepare('SELECT status FROM project_review WHERE id=?').get(target.id) as { status: string } | undefined;
      if (!row || !['approved', 'closed'].includes(row.status)) throw new Error('release_review_not_approved');
    }
  }
}

export const projectReleaseRepo = {
  get(id: string): ProjectRelease | undefined {
    const row = getDb().prepare('SELECT * FROM project_release WHERE id=?').get(id) as ProjectReleaseRow | undefined;
    return row ? projectReleaseFromRow(row) : undefined;
  },

  list(projectId: string): ProjectRelease[] {
    return (getDb().prepare('SELECT * FROM project_release WHERE project_id=? ORDER BY updated_at DESC,id DESC')
      .all(projectId) as ProjectReleaseRow[]).map(projectReleaseFromRow);
  },

  create(input: { id: string; projectId: string; name: string; description?: string; targets: ProjectReleaseTarget[] }): { release: ProjectRelease; created: boolean } {
    const name = input.name.trim();
    if (!name) throw new Error('release_name_required');
    const canonicalTargets = normalizedTargets(input.projectId, input.targets);
    const existing = projectReleaseRepo.get(input.id);
    if (existing) {
      if (existing.projectId !== input.projectId || existing.name !== name || existing.description !== (input.description?.trim() ?? '') || JSON.stringify(existing.targets) !== JSON.stringify(canonicalTargets)) {
        throw new Error('release_idempotency_conflict');
      }
      return { release: existing, created: false };
    }
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO project_release (id,project_id,name,description,status,targets_json,revision,created_at,updated_at)
      VALUES (?,?,?,?,'draft',?,1,?,?)
    `).run(input.id, input.projectId, name, input.description?.trim() ?? '', JSON.stringify(canonicalTargets), now, now);
    return { release: projectReleaseRepo.get(input.id)!, created: true };
  },

  publish(id: string, expectedRevision: number): ProjectRelease {
    const current = projectReleaseRepo.get(id);
    if (!current) throw new Error('release_not_found');
    if (current.revision !== expectedRevision) throw new Error('release_revision_conflict');
    if (current.status === 'published') return current;
    assertReady(current);
    const now = new Date().toISOString();
    const result = getDb().prepare(`
      UPDATE project_release SET status='published',revision=revision+1,updated_at=?,published_at=?
      WHERE id=? AND revision=? AND status='draft'
    `).run(now, now, id, expectedRevision);
    if (result.changes !== 1) throw new Error('release_revision_conflict');
    return projectReleaseRepo.get(id)!;
  },
};
