import { randomUUID } from 'node:crypto';
import { getDb } from '../db';

export interface ProjectRow {
  id: string;
  name: string;
  root_path: string;
  created_at: string;
  updated_at: string;
  workspace_conversation_id: string;
  agent_ids: string[];
}

interface ProjectDatabaseRow extends Omit<ProjectRow, 'agent_ids'> {
  agent_ids_json: string;
}

function hydrateProject(row: ProjectDatabaseRow | undefined): ProjectRow | undefined {
  if (!row) return undefined;
  let agentIds: string[] = [];
  try {
    const parsed = JSON.parse(row.agent_ids_json) as unknown;
    if (Array.isArray(parsed)) agentIds = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    agentIds = [];
  }
  const { agent_ids_json: _agentIdsJson, ...project } = row;
  return { ...project, agent_ids: agentIds };
}

export function normalizeProjectRootPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('project_path_required');
  const normalized = trimmed.replace(/\\/g, '/');
  return normalized.replace(/\/+$/, '') || normalized;
}

export function canonicalProjectRootPath(value: string): string {
  return normalizeProjectRootPath(value).toLocaleLowerCase('en-US');
}

export const projectRepo = {
  list(): ProjectRow[] {
    const rows = getDb().prepare(`
      SELECT project.*,
        (SELECT id FROM conversation
         WHERE project_id=project.id AND workspace_kind='project_workspace'
         LIMIT 1) AS workspace_conversation_id,
        COALESCE((SELECT json_group_array(agent_id) FROM project_agent_membership
          WHERE project_id=project.id),'[]') AS agent_ids_json
      FROM project
      ORDER BY project.updated_at DESC,project.name ASC
    `).all() as ProjectDatabaseRow[];
    return rows.map((row) => hydrateProject(row)!);
  },

  getById(id: string): ProjectRow | undefined {
    return hydrateProject(getDb().prepare(`
      SELECT project.*,
        (SELECT id FROM conversation
         WHERE project_id=project.id AND workspace_kind='project_workspace'
         LIMIT 1) AS workspace_conversation_id,
        COALESCE((SELECT json_group_array(agent_id) FROM project_agent_membership
          WHERE project_id=project.id),'[]') AS agent_ids_json
      FROM project WHERE project.id=?
    `).get(id) as ProjectDatabaseRow | undefined);
  },

  getByRootPath(rootPath: string): ProjectRow | undefined {
    return hydrateProject(getDb().prepare(`
      SELECT project.*,
        (SELECT id FROM conversation
         WHERE project_id=project.id AND workspace_kind='project_workspace'
         LIMIT 1) AS workspace_conversation_id,
        COALESCE((SELECT json_group_array(agent_id) FROM project_agent_membership
          WHERE project_id=project.id),'[]') AS agent_ids_json
      FROM project
      WHERE lower(replace(project.root_path,char(92),'/'))=?
    `)
      .get(canonicalProjectRootPath(rootPath)) as ProjectDatabaseRow | undefined);
  },

  create(input: { name: string; rootPath: string }): ProjectRow {
    const rootPath = normalizeProjectRootPath(input.rootPath);
    const name = input.name.trim();
    if (!name) throw new Error('project_name_required');
    const existing = projectRepo.getByRootPath(rootPath);
    if (existing) return existing;
    const now = new Date().toISOString();
    const id = `project-${randomUUID()}`;
    getDb().transaction(() => {
      getDb().prepare(`
        INSERT INTO project (id,name,root_path,created_at,updated_at)
        VALUES (?,?,?,?,?)
      `).run(id, name, rootPath, now, now);
      getDb().prepare(`
        INSERT INTO conversation (
          id,title,goal,status,priority,project_path,use_worktree,created_at,updated_at,
          project_id,workspace_kind
        ) VALUES (?,?,NULL,'active','p2',?,0,?,?,?,?)
      `).run(`workspace-${randomUUID()}`, name, rootPath, now, now, id, 'project_workspace');
      getDb().prepare(`
        INSERT OR IGNORE INTO project_agent_membership (project_id,agent_id,source,added_at)
        SELECT ?,id,'default',? FROM agents WHERE id IN ('mario','luigi')
      `).run(id, now);
    })();
    return projectRepo.getById(id)!;
  },
};
