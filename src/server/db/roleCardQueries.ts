import { getDb } from './index';
import type { RoleCard } from '@/types/roleCard';

export function upsertRoleCard(card: RoleCard): void {
  const db = getDb();
  const now = new Date().toISOString();
  const data = JSON.stringify(card);

  db.prepare(
    `INSERT INTO role_cards (id, data, is_preset, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       data = excluded.data,
       is_preset = excluded.is_preset,
       updated_at = excluded.updated_at`,
  ).run(card.id, data, card.isPreset ? 1 : 0, card.createdAt, now);
}

export function loadAllRoleCards(): RoleCard[] {
  const db = getDb();
  const rows = db.prepare('SELECT data FROM role_cards').all() as Array<{ data: string }>;
  return rows.map((row) => JSON.parse(row.data) as RoleCard);
}

export function deleteRoleCard(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM role_cards WHERE id = ?').run(id);
}
