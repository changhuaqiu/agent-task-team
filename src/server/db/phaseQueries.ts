import { getDb } from './index';
import type { Phase } from '@/types/phase';

export function listPhasesByConversation(conversationId: string): Phase[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM phase WHERE conversation_id = ? ORDER BY "order" ASC')
    .all(conversationId) as PhaseRow[];
  return rows.map(rowToPhase);
}

function getPhaseById(id: string): Phase | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM phase WHERE id = ?').get(id) as PhaseRow | undefined;
  return row ? rowToPhase(row) : undefined;
}

export function upsertPhase(phase: Phase): Phase {
  const db = getDb();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO phase (id, conversation_id, title, description, "order", status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       description = excluded.description,
       "order" = excluded."order",
       status = excluded.status,
       updated_at = excluded.updated_at`,
  ).run(
    phase.id,
    phase.conversationId,
    phase.title,
    phase.description ?? null,
    phase.order,
    phase.status,
    phase.createdAt,
    now,
  );

  return getPhaseById(phase.id)!;
}

export function deletePhase(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM phase WHERE id = ?').run(id);
}

interface PhaseRow {
  id: string;
  conversation_id: string;
  title: string;
  description: string | null;
  order: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToPhase(row: PhaseRow): Phase {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    title: row.title,
    description: row.description ?? '',
    order: row.order,
    status: row.status as Phase['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
