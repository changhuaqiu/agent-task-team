import { getDb } from '../db/index';

export interface DispatchRow {
  id: string;
  agent_id: string;
  dispatch_status: string | null;
  lease_expiry: string | null;
  created_at: string;
}

export const dispatchRepo = {
  claimNext(agentId: string, leaseSeconds: number): DispatchRow | undefined {
    const db = getDb();
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + leaseSeconds * 1000).toISOString();

    const result = db.prepare(`
      UPDATE invocation
      SET dispatch_status = 'claimed', lease_expiry = ?, updated_at = ?
      WHERE id = (
        SELECT id FROM invocation
        WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
        ORDER BY created_at ASC
        LIMIT 1
      )
      RETURNING id, agent_id, dispatch_status, lease_expiry, created_at
    `).get(expiry, now, agentId) as DispatchRow | undefined;

    return result;
  },

  findStaleDispatches(): DispatchRow[] {
    const db = getDb();
    const now = new Date().toISOString();
    return db.prepare(`
      SELECT id, agent_id, dispatch_status, lease_expiry, created_at
      FROM invocation
      WHERE dispatch_status = 'claimed' AND lease_expiry IS NOT NULL AND lease_expiry < ?
    `).all(now) as DispatchRow[];
  },

  resetStaleToQueued(): void {
    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE invocation
      SET dispatch_status = 'queued', lease_expiry = NULL, updated_at = ?
      WHERE dispatch_status = 'claimed' AND lease_expiry IS NOT NULL AND lease_expiry < ?
    `).run(now, now);
  },

  findPendingForAgent(agentId: string): DispatchRow[] {
    const db = getDb();
    return db.prepare(`
      SELECT id, agent_id, dispatch_status, lease_expiry, created_at
      FROM invocation
      WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
      ORDER BY created_at ASC
    `).all(agentId) as DispatchRow[];
  },

  hasPendingForAgent(agentId: string): boolean {
    const db = getDb();
    const row = db.prepare(`
      SELECT 1 FROM invocation
      WHERE agent_id = ? AND (dispatch_status = 'queued' OR dispatch_status IS NULL)
      LIMIT 1
    `).get(agentId);
    return row !== undefined;
  },
};
