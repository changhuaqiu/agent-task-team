import { getDb } from '../db/index';
import { DomainEventPublisher } from '../platform-events/domain-events';
import type { RuntimeNodeKind, RuntimeNodeStatus, RuntimeTrustLevel } from './control-plane-types';

export interface RuntimeNodeRow {
  id: string;
  kind: RuntimeNodeKind;
  label: string;
  endpoint: string | null;
  status: RuntimeNodeStatus;
  capabilities: string;
  trust_level: RuntimeTrustLevel;
  last_heartbeat_at: string | null;
  missed_heartbeats: number;
  created_at: string;
  updated_at: string;
}

export interface RegisterRuntimeNodeInput {
  id: string;
  kind: RuntimeNodeKind;
  label: string;
  endpoint?: string;
  capabilities?: string[];
  trustLevel?: RuntimeTrustLevel;
  status?: RuntimeNodeStatus;
}

export const runtimeNodeRepo = {
  register(input: RegisterRuntimeNodeInput): RuntimeNodeRow {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `INSERT INTO runtime_node (
          id, kind, label, endpoint, status, capabilities, trust_level,
          last_heartbeat_at, missed_heartbeats, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          endpoint = excluded.endpoint,
          status = excluded.status,
          capabilities = excluded.capabilities,
          trust_level = excluded.trust_level,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.id,
        input.kind,
        input.label,
        input.endpoint ?? null,
        input.status ?? 'reachable',
        JSON.stringify(input.capabilities ?? []),
        input.trustLevel ?? 'local',
        now,
        now,
        now,
      );
    return runtimeNodeRepo.getById(input.id)!;
  },

  getById(id: string): RuntimeNodeRow | undefined {
    return getDb()
      .prepare('SELECT * FROM runtime_node WHERE id = ?')
      .get(id) as RuntimeNodeRow | undefined;
  },

  list(): RuntimeNodeRow[] {
    return getDb()
      .prepare('SELECT * FROM runtime_node ORDER BY created_at ASC')
      .all() as RuntimeNodeRow[];
  },

  heartbeat(id: string): RuntimeNodeRow | undefined {
    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE runtime_node
         SET status = 'reachable', last_heartbeat_at = ?, missed_heartbeats = 0, updated_at = ?
         WHERE id = ?`,
      )
      .run(now, now, id);
    return runtimeNodeRepo.getById(id);
  },

  recordMiss(id: string, thresholds?: { staleMisses?: number; unreachableMisses?: number }): RuntimeNodeRow | undefined {
    const staleMisses = thresholds?.staleMisses ?? 2;
    const unreachableMisses = thresholds?.unreachableMisses ?? 3;
    const now = new Date().toISOString();
    const db = getDb();
    return db.transaction(() => {
      const previous = runtimeNodeRepo.getById(id);
      if (!previous) return undefined;
      db.prepare(
        `UPDATE runtime_node
         SET missed_heartbeats = missed_heartbeats + 1,
             status = CASE
               WHEN missed_heartbeats + 1 >= ? THEN 'unreachable'
               WHEN missed_heartbeats + 1 >= ? THEN 'stale'
               ELSE status
             END,
             updated_at = ?
         WHERE id = ? AND status != 'suspended'`,
      )
      .run(unreachableMisses, staleMisses, now, id);
      const current = runtimeNodeRepo.getById(id);
      if (
        current
        && current.status !== previous.status
        && (current.status === 'stale' || current.status === 'unreachable')
      ) {
        const projects = db.prepare(
          `SELECT DISTINCT conversation_id, agent_id FROM agent_binding WHERE node_id=?`,
        ).all(id) as Array<{ conversation_id: string; agent_id: string }>;
        const publisher = new DomainEventPublisher(db);
        for (const project of projects) {
          const type = current.status === 'stale' ? 'node.stale' : 'node.unreachable';
          publisher.publish({
            type,
            projectId: project.conversation_id,
            aggregate: { type: 'node', id },
            projectAgentId: project.agent_id,
            occurredAt: now,
            payload: {
              previousStatus: previous.status,
              status: current.status,
              missedHeartbeats: current.missed_heartbeats,
            },
          });
        }
      }
      return current;
    }).immediate();
  },

  setStatus(id: string, status: RuntimeNodeStatus): RuntimeNodeRow | undefined {
    const db = getDb();
    const now = new Date().toISOString();
    return db.transaction(() => {
      const previous = runtimeNodeRepo.getById(id);
      if (!previous || previous.status === status) return previous;
      const result = db
        .prepare('UPDATE runtime_node SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
        .run(status, now, id, previous.status);
      if (result.changes !== 1) return undefined;
      const current = runtimeNodeRepo.getById(id)!;
      if (status === 'stale' || status === 'unreachable') {
        const projects = db.prepare(
          `SELECT DISTINCT conversation_id, agent_id FROM agent_binding WHERE node_id=?`,
        ).all(id) as Array<{ conversation_id: string; agent_id: string }>;
        const publisher = new DomainEventPublisher(db);
        for (const project of projects) {
          publisher.publish({
            type: status === 'stale' ? 'node.stale' : 'node.unreachable',
            projectId: project.conversation_id,
            aggregate: { type: 'node', id },
            projectAgentId: project.agent_id,
            occurredAt: now,
            payload: {
              previousStatus: previous.status,
              status,
              missedHeartbeats: current.missed_heartbeats,
            },
          });
        }
      }
      return current;
    }).immediate();
  },
};
