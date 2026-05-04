import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import type Database from 'better-sqlite3';

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  setTestDb(db);
});

afterEach(() => {
  resetDb();
});

describe('skill tables exist after migration', () => {
  it('has skill table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill'").all();
    expect(tables).toHaveLength(1);
  });

  it('has skill_file table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='skill_file'").all();
    expect(tables).toHaveLength(1);
  });

  it('has agent_skill table', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_skill'").all();
    expect(tables).toHaveLength(1);
  });
});
