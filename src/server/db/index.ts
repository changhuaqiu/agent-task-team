import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { applyMigrations } from './migrate';

let db: Database.Database | null = null;

function getDataDir(): string {
  return process.env.ATH_DATA_DIR ?? path.join(process.cwd(), '.ath');
}

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(getDataDir(), 'data.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('journal_size_limit = 67108864');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  applyMigrations(db);
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.pragma('busy_timeout = 5000');
  applyMigrations(testDb);
  return testDb;
}

/** For testing: override the singleton */
export function setTestDb(testDb: Database.Database): void {
  db = testDb;
}

/** For testing: reset singleton so next getDb() creates fresh connection */
export function resetDb(): void {
  db = null;
}
