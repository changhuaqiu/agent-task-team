import { getDb } from './index';
import type { RuntimeCliEngine } from '@/lib/team-runtime/runtimeEngine';
import type { AgentResponsibility } from '@/shared/agent-definition';

export interface AgentDbRow {
  id: string;
  name: string;
  role_card_id: string;
  theme: string;
  emoji: string;
  is_preset: number;
  runtime_id: RuntimeCliEngine | null;
  account_ids: string;
  instructions: string;
  avatar_url: string | null;
  model: string | null;
  can_modify_code: number;
  can_review: number;
  responsibility: AgentResponsibility;
  created_at: string;
  updated_at: string;
}

export function listAgents(): AgentDbRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agents').all() as AgentDbRow[];
}

function getAgentById(id: string): AgentDbRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentDbRow | undefined;
}

export function upsertAgent(agent: {
  id: string;
  name: string;
  roleCardId: string;
  theme: string;
  emoji: string;
  isPreset?: boolean;
  runtimeId?: RuntimeCliEngine;
  accountIds?: string[];
}): AgentDbRow {
  const db = getDb();
  const now = new Date().toISOString();
  const isPreset = agent.isPreset ? 1 : 0;

  db.prepare(
    `INSERT INTO agents (id, name, role_card_id, theme, emoji, is_preset, runtime_id, account_ids, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role_card_id = excluded.role_card_id,
       theme = excluded.theme,
       emoji = excluded.emoji,
       is_preset = excluded.is_preset,
       runtime_id = COALESCE(excluded.runtime_id, agents.runtime_id),
       account_ids = CASE WHEN ? THEN excluded.account_ids ELSE agents.account_ids END,
       updated_at = excluded.updated_at`,
  ).run(
    agent.id,
    agent.name,
    agent.roleCardId,
    agent.theme,
    agent.emoji,
    isPreset,
    agent.runtimeId ?? null,
    JSON.stringify(agent.accountIds ?? []),
    now,
    now,
    agent.accountIds !== undefined ? 1 : 0,
  );

  return getAgentById(agent.id)!;
}

export function updateAgentExecutionConfig(
  id: string,
  input: { runtimeId: RuntimeCliEngine; accountIds: string[] },
): AgentDbRow | undefined {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE agents
    SET runtime_id=?, account_ids=?, updated_at=?
    WHERE id=?
  `).run(input.runtimeId, JSON.stringify(input.accountIds), now, id);
  return getAgentById(id);
}

export function deleteAgent(id: string): void {
  const db = getDb();
  const agent = getAgentById(id);
  if (agent?.is_preset) {
    throw new Error('Cannot delete preset agent');
  }
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}
