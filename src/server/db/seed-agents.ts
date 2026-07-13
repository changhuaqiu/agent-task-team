import { getDb } from './index';

interface PresetAgent {
  id: string;
  name: string;
  roleCardId: string;
  theme: string;
  emoji: string;
}

const PRESET_AGENTS: PresetAgent[] = [
  { id: 'mario', name: 'Mario', roleCardId: 'preset-planner', theme: 'mario', emoji: '⭐' },
  { id: 'luigi', name: 'Luigi', roleCardId: 'preset-frontend', theme: 'luigi', emoji: '⚡' },
  { id: 'peach', name: 'Peach', roleCardId: 'preset-code-reviewer', theme: 'peach', emoji: '🌸' },
  { id: 'dk', name: 'Donkey Kong', roleCardId: 'preset-arch-reviewer', theme: 'dk', emoji: '⚙️' },
];

export function seedPresetAgents(): void {
  const db = getDb();
  const now = new Date().toISOString();

  const stmt = db.prepare(
    `INSERT INTO agents (id, name, role_card_id, theme, emoji, is_preset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );

  for (const agent of PRESET_AGENTS) {
    stmt.run(agent.id, agent.name, agent.roleCardId, agent.theme, agent.emoji, now, now);
  }
}
