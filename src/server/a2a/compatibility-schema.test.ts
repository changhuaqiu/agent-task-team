import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureLegacyA2AProjectionSchema } from './compatibility-schema';

describe('ensureLegacyA2AProjectionSchema', () => {
  it('atomically restores every legacy projection required by the daemon', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE conversation (id TEXT PRIMARY KEY)');

    ensureLegacyA2AProjectionSchema(db);
    ensureLegacyA2AProjectionSchema(db);

    const tables = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table' AND name IN (
         'invocation_chain','chain_worklist','delivery_cursor',
         'a2a_audit_log','a2a_delivery'
       )
       ORDER BY name`,
    ).all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual([
      'a2a_audit_log',
      'a2a_delivery',
      'chain_worklist',
      'delivery_cursor',
      'invocation_chain',
    ]);
  });
});
