import { getDb } from '../db';

export type ProjectAgentMembershipSource = 'default' | 'team' | 'manual';

export interface ProjectAgentMembershipRow {
  project_id: string;
  agent_id: string;
  source: ProjectAgentMembershipSource;
  added_at: string;
}

function normalizeAgentIds(agentIds: string[]): string[] {
  return [...new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean))];
}

export const projectAgentMembershipRepo = {
  listByProject(projectId: string): ProjectAgentMembershipRow[] {
    return getDb().prepare(`
      SELECT project_id,agent_id,source,added_at
      FROM project_agent_membership
      WHERE project_id=?
      ORDER BY added_at,agent_id
    `).all(projectId) as ProjectAgentMembershipRow[];
  },

  listAgentIdsByProject(projectId: string): string[] {
    return projectAgentMembershipRepo.listByProject(projectId).map((row) => row.agent_id);
  },

  listAgentIdsByConversation(conversationId: string): string[] {
    return (getDb().prepare(`
      SELECT membership.agent_id
      FROM conversation
      JOIN project_agent_membership membership ON membership.project_id=conversation.project_id
      WHERE conversation.id=?
      ORDER BY membership.added_at,membership.agent_id
    `).all(conversationId) as Array<{ agent_id: string }>).map((row) => row.agent_id);
  },

  add(projectId: string, agentId: string, source: ProjectAgentMembershipSource = 'manual'): boolean {
    const now = new Date().toISOString();
    const result = getDb().prepare(`
      INSERT OR IGNORE INTO project_agent_membership (project_id,agent_id,source,added_at)
      VALUES (?,?,?,?)
    `).run(projectId, agentId.trim(), source, now);
    if (result.changes > 0) {
      getDb().prepare('UPDATE project SET updated_at=? WHERE id=?').run(now, projectId);
    }
    return result.changes > 0;
  },

  remove(projectId: string, agentId: string): boolean {
    const now = new Date().toISOString();
    const result = getDb().prepare(`
      DELETE FROM project_agent_membership WHERE project_id=? AND agent_id=?
    `).run(projectId, agentId.trim());
    if (result.changes > 0) {
      getDb().prepare('UPDATE project SET updated_at=? WHERE id=?').run(now, projectId);
    }
    return result.changes > 0;
  },

  replace(projectId: string, agentIds: string[], source: ProjectAgentMembershipSource): string[] {
    const normalized = normalizeAgentIds(agentIds);
    const now = new Date().toISOString();
    const db = getDb();
    db.prepare('DELETE FROM project_agent_membership WHERE project_id=?').run(projectId);
    const insert = db.prepare(`
      INSERT INTO project_agent_membership (project_id,agent_id,source,added_at)
      VALUES (?,?,?,?)
    `);
    for (const agentId of normalized) insert.run(projectId, agentId, source, now);
    db.prepare('UPDATE project SET updated_at=? WHERE id=?').run(now, projectId);
    return normalized;
  },
};
