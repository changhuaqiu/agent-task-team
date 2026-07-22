import { getDb } from './index';

export interface AgentDbRow {
  id: string;
  name: string;
  role_card_id: string;
  theme: string;
  emoji: string;
  account_ids: string;
  is_preset: number;
  created_at: string;
  updated_at: string;
}

export function listAgents(): AgentDbRow[] {
  const db = getDb();
  return db.prepare('SELECT * FROM agents').all() as AgentDbRow[];
}

export function getAgentById(id: string): AgentDbRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentDbRow | undefined;
}

export function parseAgentAccountIds(agent: Pick<AgentDbRow, 'account_ids'>): string[] {
  try {
    const parsed = JSON.parse(agent.account_ids);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function updateAgentAccountIds(id: string, accountIds: string[]): AgentDbRow | undefined {
  const normalized = [...new Set(accountIds.map((item) => item.trim()).filter(Boolean))];
  const result = getDb().prepare(
    'UPDATE agents SET account_ids = ?, updated_at = ? WHERE id = ?',
  ).run(JSON.stringify(normalized), new Date().toISOString(), id);
  return result.changes === 1 ? getAgentById(id) : undefined;
}

export function upsertAgent(agent: {
  id: string;
  name: string;
  roleCardId: string;
  theme: string;
  emoji: string;
  isPreset?: boolean;
}): AgentDbRow {
  const db = getDb();
  const now = new Date().toISOString();
  const isPreset = agent.isPreset ? 1 : 0;

  db.prepare(
    `INSERT INTO agents (id, name, role_card_id, theme, emoji, is_preset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       role_card_id = excluded.role_card_id,
       theme = excluded.theme,
       emoji = excluded.emoji,
       is_preset = excluded.is_preset,
       updated_at = excluded.updated_at`,
  ).run(agent.id, agent.name, agent.roleCardId, agent.theme, agent.emoji, isPreset, now, now);

  return getAgentById(agent.id)!;
}

export function deleteAgent(id: string): void {
  const db = getDb();
  const agent = getAgentById(id);
  if (agent?.is_preset) {
    throw new Error('Cannot delete preset agent');
  }
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}
