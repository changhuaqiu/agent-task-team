import type Database from 'better-sqlite3';

const preparedDatabases = new WeakSet<Database.Database>();

export function ensureLegacyA2AProjectionSchema(db: Database.Database): void {
  if (preparedDatabases.has(db)) return;

  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS invocation_chain (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id),
        root_trigger_type TEXT NOT NULL,
        root_trigger_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        config TEXT NOT NULL,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_chain_conv ON invocation_chain(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_chain_status ON invocation_chain(status);

      CREATE TABLE IF NOT EXISTS chain_worklist (
        id TEXT PRIMARY KEY,
        chain_id TEXT NOT NULL REFERENCES invocation_chain(id),
        agent_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        prompt TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'queued',
        outcome TEXT,
        queued_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_worklist_chain ON chain_worklist(chain_id);
      CREATE INDEX IF NOT EXISTS idx_worklist_agent ON chain_worklist(agent_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_worklist_hash
        ON chain_worklist(chain_id, content_hash);

      CREATE TABLE IF NOT EXISTS delivery_cursor (
        agent_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        last_chain_id TEXT,
        last_entry_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, conversation_id)
      );

      CREATE TABLE IF NOT EXISTS a2a_audit_log (
        id TEXT PRIMARY KEY,
        chain_id TEXT,
        conversation_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_agent_id TEXT,
        to_agent_id TEXT,
        content_hash TEXT,
        reason TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_chain ON a2a_audit_log(chain_id);
      CREATE INDEX IF NOT EXISTS idx_audit_conv ON a2a_audit_log(conversation_id);

      CREATE TABLE IF NOT EXISTS a2a_delivery (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id),
        chain_id TEXT NOT NULL REFERENCES invocation_chain(id),
        entry_id TEXT NOT NULL REFERENCES chain_worklist(id),
        pass_id TEXT,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'a2a:dispatch',
        payload TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_delivery_conv
        ON a2a_delivery(conversation_id, status);
      CREATE INDEX IF NOT EXISTS idx_a2a_delivery_entry ON a2a_delivery(entry_id);
      CREATE INDEX IF NOT EXISTS idx_a2a_delivery_agent
        ON a2a_delivery(agent_id, status);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_a2a_delivery_entry ON a2a_delivery(entry_id);
    `);
  }).immediate();

  preparedDatabases.add(db);
}
