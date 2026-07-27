import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations } from '../db/migrate';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';

const now = '2026-07-19T00:00:00.000Z';
let tempDir: string;

beforeEach(() => {
  setTestDb(createTestDb());
  tempDir = mkdtempSync(join(tmpdir(), 'ath-eval-recovery-'));
  getDb().prepare(`INSERT INTO conversation
    (id,title,status,participants,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
    .run('conv-backup', 'Backup drill', 'active', '[]', now, now);
  getDb().prepare(`INSERT INTO eval_dataset
    (id,conversation_id,name,description,revision,status,created_by,created_at,updated_at)
    VALUES ('dataset-backup','conv-backup','Recovery set','restore evidence',1,'active','test',?,?)`)
    .run(now, now);
  getDb().prepare(`INSERT INTO eval_case
    (id,dataset_id,case_key,split,source_type,input_payload,expected_labels,metadata,
     content_hash,redaction_status,created_at)
    VALUES ('case-backup','dataset-backup','recovery-1','held_out','manual','{}','{}','{}',
      'hash','redacted',?)`).run(now);
});

afterEach(() => {
  resetDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('evaluation backup and recovery drill', () => {
  it('restores evaluation datasets into an independently opened SQLite backup', async () => {
    const backupPath = join(tempDir, 'agent-task-hub.backup.db');
    await getDb().backup(backupPath);
    const restored = new Database(backupPath);
    try {
      restored.pragma('foreign_keys = ON');
      applyMigrations(restored);
      expect(restored.prepare('SELECT MAX(version) version FROM _schema_version').get())
        .toEqual({ version: 63 });
      expect(restored.prepare(`SELECT d.name,d.revision,c.case_key,c.split
        FROM eval_dataset d JOIN eval_case c ON c.dataset_id=d.id
        WHERE d.conversation_id='conv-backup'`).get()).toEqual({
        name: 'Recovery set',
        revision: 1,
        case_key: 'recovery-1',
        split: 'held_out',
      });
      expect(restored.pragma('foreign_key_check')).toEqual([]);
    } finally {
      restored.close();
    }
  });
});
