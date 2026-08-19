import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './index';
import { applyMigrations } from './migrate';
import { PlatformEventLog } from '../platform-events/event-log';

describe('SQLite Foundation', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('initializes all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    const tableNames = tables.map((t: Record<string, string>) => t.name);
    expect(tableNames).toContain('conversation');
    expect(tableNames).toContain('task');
    expect(tableNames).toContain('chat_message');
    expect(tableNames).toContain('agent_session');
    expect(tableNames).toContain('invocation');
    expect(tableNames).toContain('agent_event');
    expect(tableNames).toContain('platform_event');
    expect(tableNames).toContain('platform_event_delivery');
    expect(tableNames).toContain('platform_event_delivery_attempt');
    expect(tableNames).toContain('platform_event_handler_cursor');
    expect(tableNames).toContain('platform_event_ingestion');
    expect(tableNames).toContain('runtime_invocation_projection');
    expect(tableNames).toContain('runtime_message_projection');
    expect(tableNames).toContain('runtime_observability_projection');
    expect(tableNames).toContain('runtime_completion_context');
    expect(tableNames).toContain('platform_effect_outbox');
    expect(tableNames).toContain('platform_effect_attempt');
    expect(tableNames).toContain('runtime_completion_legacy_effect_suppression');
    expect(tableNames).not.toContain('runtime_completion_step_receipt');
    expect(tableNames).toContain('agent_inbox_item');
    expect(tableNames).toContain('task_command_rejection_receipt');
    expect(tableNames).toContain('eval_review_queue');
    expect(tableNames).toContain('eval_pairwise_round');
    expect(tableNames).toContain('github_issue_ingress');
    expect(tableNames).toContain('quality_gate');
    expect(tableNames).toContain('quality_gate_evidence');
    expect(tableNames).toContain('quality_gate_decision');
    expect(tableNames).toContain('work_contract');
    expect(tableNames).toContain('work_authority');
    expect(tableNames).toContain('agent_outcome');
    expect(tableNames).toContain('delivery_control_decision');
    expect(tableNames).toContain('delivery_control_action');
    expect(tableNames).not.toContain('supervisor_control_decision');
    expect(tableNames).not.toContain('supervisor_control_action');
    expect(tableNames).toContain('a2a_possession_chain');
    expect(tableNames).toContain('a2a_possession');
    expect(tableNames).toContain('a2a_pass_group');
    expect(tableNames).toContain('a2a_pass');
    expect(tableNames).toContain('a2a_handoff_packet');
    expect(tableNames).not.toContain('agent_team_pack');
  });

  it('creates indexes', () => {
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all();
    expect(indexes.length).toBeGreaterThanOrEqual(9);
  });

  it('enforces foreign keys', () => {
    const result = db.pragma('foreign_keys') as Array<Record<string, number>>;
    expect(result[0].foreign_keys).toBe(1);
  });

  it('does not cascade Task rejection receipts with their aggregate', () => {
    const foreignKeys = db.pragma('foreign_key_list(task_command_rejection_receipt)') as Array<{
      from: string;
      on_delete: string;
    }>;
    expect(foreignKeys.some((foreignKey) => foreignKey.from === 'conversation_id')).toBe(false);
    expect(foreignKeys.some((foreignKey) => foreignKey.from === 'task_id')).toBe(false);
    expect(foreignKeys.find((foreignKey) => foreignKey.from === 'recovery_inbox_item_id')?.on_delete)
      .toBe('SET NULL');
  });

  it('tracks schema version', () => {
    const row = db.prepare('SELECT MAX(version) as v FROM _schema_version').get() as {
      v: number;
    };
    expect(row.v).toBeGreaterThanOrEqual(1);
  });

  it('removes retired HTTP bridge runtime nodes and their live bindings', () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO runtime_node (
        id,kind,label,endpoint,status,capabilities,trust_level,
        last_heartbeat_at,missed_heartbeats,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'bridge:https://legacy.example', 'bridge', 'Legacy bridge',
      'https://legacy.example', 'reachable', '["execute","bridge-run"]',
      'paired', now, 0, now, now,
    );
    db.prepare(`
      INSERT INTO agent_binding (
        id,conversation_id,agent_id,node_id,runtime_id,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,'idle',?,?)
    `).run(
      'binding-legacy-bridge', 'conv-legacy', 'mario',
      'bridge:https://legacy.example', 'opencode', now, now,
    );
    db.prepare(`
      INSERT INTO runtime_node (
        id,kind,label,endpoint,status,capabilities,trust_level,
        last_heartbeat_at,missed_heartbeats,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      'remote:retained', 'remote', 'Remote executor',
      'https://remote.example', 'reachable', '["execute"]',
      'paired', now, 0, now, now,
    );
    db.prepare(`
      INSERT INTO agent_binding (
        id,conversation_id,agent_id,node_id,runtime_id,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,'idle',?,?)
    `).run(
      'binding-remote-retained', 'conv-remote', 'luigi',
      'remote:retained', 'opencode', now, now,
    );
    db.prepare('DELETE FROM _schema_version WHERE version=76').run();

    applyMigrations(db);

    expect(db.prepare("SELECT id FROM runtime_node WHERE kind='bridge'").all()).toEqual([]);
    expect(db.prepare('SELECT id FROM agent_binding WHERE id=?').get('binding-legacy-bridge'))
      .toBeUndefined();
    expect(db.prepare('SELECT id,kind FROM runtime_node WHERE id=?').get('remote:retained'))
      .toEqual({ id: 'remote:retained', kind: 'remote' });
    expect(db.prepare('SELECT id FROM agent_binding WHERE id=?').get('binding-remote-retained'))
      .toEqual({ id: 'binding-remote-retained' });
  });

  it('backfills legacy session engine and account from the latest successful invocation', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('conv-profile', 'Profile', 'active', now, now);
    db.prepare(
      `INSERT INTO agent_session (
        id,conversation_id,agent_id,task_id,seq,status,created_at,engine,runtime_id,account_id
      ) VALUES (?,?,?,?,?,'active',?,NULL,NULL,NULL)`,
    ).run('ses-profile', 'conv-profile', 'mario', 'task-profile', 0, now);
    db.prepare(
      `INSERT INTO invocation (
        id,conversation_id,agent_id,session_id,status,outcome,engine,account_id,created_at,updated_at
      ) VALUES (?,?,?,?,'terminated','completed',?,?,?,?)`,
    ).run(
      'inv-profile',
      'conv-profile',
      'mario',
      'ses-profile',
      'codex',
      'account-openai',
      now,
      now,
    );
    db.prepare('DELETE FROM _schema_version WHERE version=53').run();

    applyMigrations(db);

    expect(db.prepare(
      'SELECT engine,runtime_id,account_id FROM agent_session WHERE id=?',
    ).get('ses-profile')).toEqual({
      engine: 'codex',
      runtime_id: null,
      account_id: 'account-openai',
    });
  });

  it('enforces GitHub Issue delivery and repository Issue uniqueness', () => {
    const indexes = db.prepare(
      "PRAGMA index_list('github_issue_ingress')",
    ).all() as Array<{ name: string; unique: number }>;
    const uniqueColumns = indexes
      .filter((index) => index.unique === 1)
      .map((index) => (
        db.prepare(`PRAGMA index_info('${index.name.replaceAll("'", "''")}')`)
          .all() as Array<{ seqno: number; name: string }>
      )
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name)
        .join(','));

    expect(uniqueColumns).toContain('delivery_id');
    expect(uniqueColumns).toContain('repository_full_name,issue_number');
  });

  it('can insert and query a conversation', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-1', 'Test Conversation', 'active', now, now);
    const row = db.prepare('SELECT * FROM conversation WHERE id = ?').get('conv-1') as Record<
      string,
      string
    >;
    expect(row.title).toBe('Test Conversation');
  });

  it('enforces task → conversation FK', () => {
    const now = new Date().toISOString();
    expect(() => {
      db.prepare(
        'INSERT INTO task (id, conversation_id, title, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('task-1', 'nonexistent', 'Test', 'ready', 'agent-1', now, now);
    }).toThrow();
  });

  it('migrates legacy task states into the canonical task state machine', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-task-state', 'Task state migration', 'active', now, now);
    db.exec(`
      DROP TRIGGER trg_task_status_insert;
      DROP TRIGGER trg_task_status_update;
      DROP TRIGGER trg_task_transition_update;
      DELETE FROM _schema_version WHERE version = 54;
    `);
    const insert = db.prepare(
      'INSERT INTO task (id, conversation_id, title, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const [id, status] of [
      ['task-pending', 'pending'],
      ['task-completed', 'completed'],
      ['task-approved', 'approved'],
      ['task-rejected', 'rejected'],
      ['task-canceled', 'canceled'],
      ['task-unknown', 'test_gate'],
    ]) {
      insert.run(id, 'conv-task-state', id, status, 'agent-1', now, now);
    }

    applyMigrations(db);

    expect(db.prepare(
      "SELECT id, status FROM task WHERE conversation_id='conv-task-state' ORDER BY id",
    ).all()).toEqual([
      { id: 'task-approved', status: 'done' },
      { id: 'task-canceled', status: 'cancelled' },
      { id: 'task-completed', status: 'done' },
      { id: 'task-pending', status: 'ready' },
      { id: 'task-rejected', status: 'in_progress' },
      { id: 'task-unknown', status: 'blocked' },
    ]);
    expect(db.prepare(
      "SELECT review_note FROM task WHERE id='task-unknown'",
    ).get()).toEqual({
      review_note: '[migration] unsupported legacy status: test_gate',
    });
  });

  it('rejects task status writes that bypass the canonical vocabulary', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-task-guard', 'Task state guard', 'active', now, now);

    expect(() => db.prepare(
      'INSERT INTO task (id, conversation_id, title, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('task-invalid', 'conv-task-guard', 'Invalid', 'pending', 'agent-1', now, now))
      .toThrow(/invalid_task_status/);

    db.prepare(
      'INSERT INTO task (id, conversation_id, title, status, agent_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('task-valid', 'conv-task-guard', 'Valid', 'ready', 'agent-1', now, now);
    expect(() => db.prepare("UPDATE task SET status='approved' WHERE id='task-valid'").run())
      .toThrow(/invalid_task_status/);
    expect(() => db.prepare("UPDATE task SET status='done' WHERE id='task-valid'").run())
      .toThrow(/invalid_task_transition/);
  });

  it('migrates invocation lifecycle separately from terminal outcome', () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.exec(`
        CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE invocation (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          reason_code TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      const recordVersion = legacyDb.prepare(
        'INSERT INTO _schema_version (version) VALUES (?)',
      );
      for (let version = 1; version <= 54; version += 1) recordVersion.run(version);
      recordVersion.run(56);
      const insert = legacyDb.prepare(
        'INSERT INTO invocation (id,status,reason_code,updated_at) VALUES (?,?,NULL,?)',
      );
      for (const [id, status] of [
        ['inv-queued', 'queued'],
        ['inv-running', 'running'],
        ['inv-succeeded', 'succeeded'],
        ['inv-failed', 'failed'],
        ['inv-cancelled', 'canceled'],
        ['inv-unknown', 'mystery'],
      ]) {
        insert.run(id, status, '2026-07-27T00:00:00.000Z');
      }

      applyMigrations(legacyDb);

      expect(legacyDb.prepare(
        'SELECT id,status,outcome,reason_code FROM invocation ORDER BY id',
      ).all()).toEqual([
        { id: 'inv-cancelled', status: 'terminated', outcome: 'cancelled', reason_code: null },
        { id: 'inv-failed', status: 'terminated', outcome: 'failed', reason_code: null },
        { id: 'inv-queued', status: 'planned', outcome: null, reason_code: null },
        { id: 'inv-running', status: 'running', outcome: null, reason_code: null },
        { id: 'inv-succeeded', status: 'terminated', outcome: 'completed', reason_code: null },
        {
          id: 'inv-unknown',
          status: 'terminated',
          outcome: 'failed',
          reason_code: 'legacy_invocation_status_unknown',
        },
      ]);
      legacyDb.prepare(
        "INSERT INTO invocation (id,status,updated_at) VALUES ('inv-new','planned',?)",
      ).run('2026-07-27T00:01:00.000Z');
      expect(() => legacyDb.prepare(
        "UPDATE invocation SET status='running' WHERE id='inv-new'",
      ).run()).toThrow(/invalid_invocation_transition/);
      expect(() => legacyDb.prepare(
        "UPDATE invocation SET status='terminated' WHERE id='inv-new'",
      ).run()).toThrow(/invalid_invocation_outcome/);
    } finally {
      legacyDb.close();
    }
  });

  it('migrates Agent Inbox admission semantics and rejects illegal transitions', () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.pragma('foreign_keys = ON');
      legacyDb.exec(`
        CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE conversation (id TEXT PRIMARY KEY);
        CREATE TABLE platform_event (id TEXT PRIMARY KEY);
        CREATE TABLE agent_inbox_item (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
          project_agent_id TEXT NOT NULL,
          source_event_id TEXT REFERENCES platform_event(id) ON DELETE SET NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          command_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','failed','cancelled')),
          attempt_count INTEGER NOT NULL DEFAULT 0,
          available_at TEXT NOT NULL,
          lease_token TEXT,
          lease_expires_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          claimed_at TEXT,
          completed_at TEXT,
          UNIQUE(source_event_id, project_agent_id)
        );
        INSERT INTO conversation (id) VALUES ('project-1');
      `);
      const recordVersion = legacyDb.prepare(
        'INSERT INTO _schema_version (version) VALUES (?)',
      );
      for (let version = 1; version <= 55; version += 1) recordVersion.run(version);
      const insert = legacyDb.prepare(`
        INSERT INTO agent_inbox_item (
          id,project_id,project_agent_id,idempotency_key,command_json,status,
          attempt_count,available_at,lease_token,lease_expires_at,last_error,
          created_at,updated_at,claimed_at,completed_at
        ) VALUES (?, 'project-1', 'agent-1', ?, '{}', ?, 1, ?, ?, ?, NULL, ?, ?, ?, ?)
      `);
      const now = '2026-07-27T00:00:00.000Z';
      insert.run('inbox-queued', 'key-queued', 'queued', now, null, null, now, now, null, null);
      insert.run('inbox-claimed', 'key-claimed', 'claimed', now, 'lease-1', now, now, now, now, null);
      insert.run('inbox-stale-claim', 'key-stale-claim', 'claimed', now, null, null, now, now, now, null);
      insert.run('inbox-completed', 'key-completed', 'completed', now, null, null, now, now, now, now);
      insert.run('inbox-failed', 'key-failed', 'failed', now, null, null, now, now, now, now);

      applyMigrations(legacyDb);

      expect(legacyDb.prepare(
        'SELECT id,status,settled_at FROM agent_inbox_item ORDER BY id',
      ).all()).toEqual([
        { id: 'inbox-claimed', status: 'claimed', settled_at: null },
        { id: 'inbox-completed', status: 'admitted', settled_at: now },
        { id: 'inbox-failed', status: 'expired', settled_at: now },
        { id: 'inbox-queued', status: 'enqueued', settled_at: null },
        { id: 'inbox-stale-claim', status: 'released', settled_at: null },
      ]);
      expect(() => legacyDb.prepare(
        "UPDATE agent_inbox_item SET status='admitted', settled_at=? WHERE id='inbox-queued'",
      ).run(now)).toThrow(/invalid_agent_inbox_transition/);
      expect(() => legacyDb.prepare(
        "UPDATE agent_inbox_item SET status='claimed' WHERE id='inbox-queued'",
      ).run()).toThrow(/invalid_agent_inbox_lease/);
    } finally {
      legacyDb.close();
    }
  });

  it('migrates ExecutionEnvelope to acknowledgement semantics', () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.exec(`
        CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE execution_envelope (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          reason_code TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      const recordVersion = legacyDb.prepare(
        'INSERT INTO _schema_version (version) VALUES (?)',
      );
      for (let version = 1; version <= 56; version += 1) recordVersion.run(version);
      const insert = legacyDb.prepare(
        'INSERT INTO execution_envelope (id,status,reason_code,updated_at) VALUES (?,?,?,?)',
      );
      const now = '2026-07-27T00:00:00.000Z';
      insert.run('env-blocked', 'blocked', null, now);
      insert.run('env-completed', 'completed', null, now);
      insert.run('env-failed', 'failed', 'spawn_failed', now);
      insert.run('env-queued', 'queued', null, now);
      insert.run('env-started', 'started', null, now);
      insert.run('env-unknown', 'mystery', null, now);

      applyMigrations(legacyDb);

      expect(legacyDb.prepare(
        'SELECT id,status,reason_code,settled_at FROM execution_envelope ORDER BY id',
      ).all()).toEqual([
        {
          id: 'env-blocked',
          status: 'rejected',
          reason_code: 'legacy_dispatch_rejected',
          settled_at: now,
        },
        { id: 'env-completed', status: 'acknowledged', reason_code: null, settled_at: now },
        { id: 'env-failed', status: 'rejected', reason_code: 'spawn_failed', settled_at: now },
        { id: 'env-queued', status: 'validated', reason_code: null, settled_at: null },
        { id: 'env-started', status: 'acknowledged', reason_code: null, settled_at: now },
        {
          id: 'env-unknown',
          status: 'rejected',
          reason_code: 'legacy_execution_envelope_status_unknown',
          settled_at: now,
        },
      ]);
      legacyDb.prepare(
        "INSERT INTO execution_envelope (id,status,updated_at) VALUES ('env-new','drafted',?)",
      ).run(now);
      expect(() => legacyDb.prepare(
        "UPDATE execution_envelope SET status='sent' WHERE id='env-new'",
      ).run()).toThrow(/invalid_execution_envelope_transition/);
      expect(() => legacyDb.prepare(`
        UPDATE execution_envelope
        SET status='rejected', settled_at=?
        WHERE id='env-new'
      `).run(now)).toThrow(/invalid_execution_envelope_settlement/);
    } finally {
      legacyDb.close();
    }
  });

  it('enforces agent_session unique constraint', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-1', 'Test', 'active', now, now);

    db.prepare(
      'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('ses-1', 'conv-1', 'agent-1', 'task-1', 0, now);

    expect(() => {
      db.prepare(
        'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('ses-2', 'conv-1', 'agent-1', 'task-1', 0, now);
    }).toThrow();
  });

  it('enforces one active session per conversation and agent', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-active', 'Active Test', 'active', now, now);

    db.prepare(
      'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('ses-active-1', 'conv-active', 'agent-1', 'task-a', 0, now);

    expect(() => {
      db.prepare(
        'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('ses-active-2', 'conv-active', 'agent-1', 'task-b', 1, now);
    }).toThrow();

    db.prepare("UPDATE agent_session SET status = 'sealed' WHERE id = 'ses-active-1'").run();
    expect(() => {
      db.prepare(
        'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('ses-active-2', 'conv-active', 'agent-1', 'task-b', 1, now);
    }).not.toThrow();
  });

  it('migration seals duplicate active rows before restoring the unique index', () => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-migrate', 'Migration Test', 'active', now, now);
    db.exec('DROP INDEX uq_agent_session_active_project_agent');
    db.prepare('DELETE FROM _schema_version WHERE version >= 20').run();
    const insert = db.prepare(
      'INSERT INTO agent_session (id, conversation_id, agent_id, task_id, seq, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insert.run('ses-migrate-old', 'conv-migrate', 'agent-migrate', 'task-old', 0, '2026-01-01T00:00:00.000Z');
    insert.run('ses-migrate-new', 'conv-migrate', 'agent-migrate', 'task-new', 1, '2026-01-02T00:00:00.000Z');

    applyMigrations(db);

    const rows = db.prepare(
      'SELECT id, status, seal_reason FROM agent_session WHERE conversation_id = ? ORDER BY created_at',
    ).all('conv-migrate') as Array<{ id: string; status: string; seal_reason: string | null }>;
    expect(rows).toEqual([
      { id: 'ses-migrate-old', status: 'sealed', seal_reason: 'migration_duplicate_active' },
      { id: 'ses-migrate-new', status: 'active', seal_reason: null },
    ]);
  });

  it('migration is idempotent', () => {
    const before = db.prepare('SELECT MAX(version) as v FROM _schema_version').get() as {
      v: number;
    };
    applyMigrations(db);
    const after = db.prepare('SELECT MAX(version) as v FROM _schema_version').get() as {
      v: number;
    };
    expect(before.v).toBeGreaterThanOrEqual(1);
    expect(after.v).toBe(before.v);
  });

  it('upgrades ControlAction when the earlier attempt-column migration was recorded out of order', () => {
    const legacyDb = new Database(':memory:');
    try {
      legacyDb.exec(`
        CREATE TABLE _schema_version (version INTEGER PRIMARY KEY);
        CREATE TABLE conversation (id TEXT PRIMARY KEY);
        CREATE TABLE autonomous_delivery_run (id TEXT PRIMARY KEY);
        CREATE TABLE delivery_control_decision (id TEXT PRIMARY KEY);
        CREATE TABLE delivery_control_action (
          id TEXT PRIMARY KEY,
          decision_id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          type TEXT NOT NULL,
          target_work_id TEXT,
          work_epoch INTEGER,
          slot_id TEXT,
          reason_code TEXT NOT NULL,
          retry_budget_kind TEXT,
          termination_outcome TEXT,
          status TEXT NOT NULL,
          claim_token TEXT,
          lease_owner TEXT,
          lease_expires_at TEXT,
          failure_code TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          completed_at TEXT
        );
        INSERT INTO conversation (id) VALUES ('project-1');
        INSERT INTO autonomous_delivery_run (id) VALUES ('run-1');
        INSERT INTO delivery_control_decision (id) VALUES ('decision-1');
        INSERT INTO delivery_control_action (
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          status,created_at,updated_at
        ) VALUES (
          'legacy-action','decision-1','run-1','activate','work-1',1,
          'implementer:1','work_ready','ready','2026-07-28T00:00:00.000Z',
          '2026-07-28T00:00:00.000Z'
        );
      `);
      const recordVersion = legacyDb.prepare(
        'INSERT INTO _schema_version (version) VALUES (?)',
      );
      for (let version = 1; version <= 82; version += 1) recordVersion.run(version);

      applyMigrations(legacyDb);

      expect(legacyDb.prepare(`
        SELECT type,attempt_count,max_attempts FROM delivery_control_action
        WHERE id='legacy-action'
      `).get()).toEqual({ type: 'activate', attempt_count: 0, max_attempts: 3 });
      expect(legacyDb.prepare('SELECT MAX(version) AS version FROM _schema_version').get())
        .toEqual({ version: 85 });
      expect(() => legacyDb.prepare(`
        INSERT INTO delivery_control_action (
          id,decision_id,run_id,type,target_work_id,work_epoch,slot_id,reason_code,
          status,created_at,updated_at
        ) VALUES (
          'continue-action','decision-1','run-1','continue','work-1',1,
          'implementer:1','agent_requested_continuation','ready',
          '2026-07-28T00:01:00.000Z','2026-07-28T00:01:00.000Z'
        )
      `).run()).not.toThrow();
    } finally {
      legacyDb.close();
    }
  });

  it('guards immutable Delivery start keys and claimed ControlAction lease shape', () => {
    const now = '2026-07-28T08:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('conv-lease-guard','Lease guard','active',?,?)
    `).run(now, now);
    db.prepare(`
      INSERT INTO autonomous_delivery_run (
        id,conversation_id,status,current_stage,goal_contract_json,repair_cycle,revision,
        created_at,updated_at,start_idempotency_key
      ) VALUES ('run-lease-guard','conv-lease-guard','active','planning','{}',0,0,?,?,?)
    `).run(now, now, 'start-key-1');
    expect(() => db.prepare(`
      UPDATE autonomous_delivery_run SET start_idempotency_key='rebound'
      WHERE id='run-lease-guard'
    `).run()).toThrow('delivery_run_start_idempotency_key_immutable');

    db.prepare(`
      INSERT INTO delivery_control_decision (
        id,run_id,project_id,snapshot_revision,policy_revision,payload_json,status,created_at
      ) VALUES ('decision-lease-guard','run-lease-guard','conv-lease-guard',0,1,'{}','active',?)
    `).run(now);
    db.prepare(`
      INSERT INTO delivery_control_action (
        id,decision_id,run_id,type,reason_code,status,created_at,updated_at
      ) VALUES (
        'action-lease-guard','decision-lease-guard','run-lease-guard',
        'initializeGraph','test','ready',?,?
      )
    `).run(now, now);
    expect(() => db.prepare(`
      UPDATE delivery_control_action SET status='claimed'
      WHERE id='action-lease-guard'
    `).run()).toThrow('delivery_control_action_lease_shape_invalid');
    expect(db.prepare(`
      UPDATE delivery_control_action
      SET status='claimed',claim_token='claim-1',lease_owner='worker-1',lease_expires_at=?
      WHERE id='action-lease-guard'
    `).run('2026-07-28T08:01:00.000Z').changes).toBe(1);
    expect(() => db.prepare(`
      UPDATE delivery_control_action SET status='applied'
      WHERE id='action-lease-guard'
    `).run()).toThrow('delivery_control_action_lease_shape_invalid');
  });

  it('marks pre-cutover Runtime events as already projected', () => {
    const now = '2026-07-25T04:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-cutover', 'Cutover', 'active', now, now);
    new PlatformEventLog({ db }).append({
      type: 'runtime.message.segment.completed',
      category: 'runtime_activity',
      projectId: 'conv-cutover',
      streamKey: 'invocation:inv-cutover',
      aggregate: { type: 'invocation', id: 'inv-cutover' },
      actor: { type: 'runtime', id: 'daemon' },
      invocationId: 'inv-cutover',
      correlationId: 'trace-cutover',
      payload: { segmentId: 'segment-1', text: 'already projected' },
    });
    db.exec(`
      DROP TABLE runtime_message_projection;
      DROP TABLE runtime_observability_projection;
      DELETE FROM _schema_version WHERE version=51;
    `);

    applyMigrations(db);

    expect(db.prepare('SELECT COUNT(*) count FROM runtime_message_projection').get())
      .toEqual({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) count FROM runtime_observability_projection').get())
      .toEqual({ count: 1 });
  });

  it('migrates partial v51 completion receipts into effect suppressions', () => {
    const now = '2026-07-25T04:30:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run('conv-effect-upgrade', 'Effect upgrade', 'active', now, now);
    const terminal = new PlatformEventLog({ db }).append({
      type: 'runtime.invocation.terminated',
      category: 'runtime_lifecycle',
      projectId: 'conv-effect-upgrade',
      streamKey: 'invocation:inv-effect-upgrade',
      aggregate: { type: 'invocation', id: 'inv-effect-upgrade' },
      actor: { type: 'runtime', id: 'daemon' },
      invocationId: 'inv-effect-upgrade',
      correlationId: 'trace-effect-upgrade',
      payload: { status: 'completed' },
    });
    db.prepare(`
      INSERT INTO invocation (
        id,conversation_id,agent_id,status,outcome,engine,created_at,updated_at
      ) VALUES (?,?,?,'terminated','completed','codex',?,?)
    `).run(
      'inv-effect-upgrade',
      'conv-effect-upgrade',
      'implementer',
      now,
      now,
    );
    db.prepare(`
      INSERT INTO runtime_completion_context (
        invocation_id,conversation_id,agent_id,task_project_dir,status,created_at,updated_at
      ) VALUES (?,?,?,?,'pending',?,?)
    `).run(
      'inv-effect-upgrade',
      'conv-effect-upgrade',
      'implementer',
      'C:/tmp/effect-upgrade',
      now,
      now,
    );
    db.exec(`
      DROP TABLE platform_effect_attempt;
      DROP TABLE platform_effect_outbox;
      DROP TABLE runtime_completion_legacy_effect_suppression;
      CREATE TABLE runtime_completion_step_receipt (
        event_id TEXT NOT NULL REFERENCES platform_event(id) ON DELETE CASCADE,
        step TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        PRIMARY KEY(event_id,step)
      );
      DELETE FROM _schema_version WHERE version=52;
    `);
    const insertReceipt = db.prepare(`
      INSERT INTO runtime_completion_step_receipt (event_id,step,completed_at) VALUES (?,?,?)
    `);
    insertReceipt.run(terminal.eventId, 'task-sync', now);
    insertReceipt.run(terminal.eventId, 'a2a-response', now);

    applyMigrations(db);

    expect(db.prepare(`
      SELECT effect_type FROM runtime_completion_legacy_effect_suppression
      WHERE event_id=? ORDER BY effect_type
    `).all(terminal.eventId)).toEqual([
      { effect_type: 'runtime.a2a_response' },
      { effect_type: 'runtime.task_sync' },
    ]);
    expect(db.prepare(`
      SELECT status FROM runtime_completion_context WHERE invocation_id='inv-effect-upgrade'
    `).get()).toEqual({ status: 'pending' });
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='runtime_completion_step_receipt'
    `).get()).toBeUndefined();
  });

  it('applies a missing lower migration even when a higher version is recorded', () => {
    db.prepare('DELETE FROM _schema_version WHERE version = 40').run();

    applyMigrations(db);

    expect(db.prepare('SELECT version FROM _schema_version WHERE version = 40').get())
      .toEqual({ version: 40 });
    expect(db.prepare('SELECT MAX(version) AS version FROM _schema_version').get())
      .toEqual({ version: 85 });
  });

  it('retires the parallel A2A worklist schema at migration 62', () => {
    const retiredTables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'invocation_chain','chain_worklist','delivery_cursor',
        'a2a_audit_log','a2a_delivery'
      )
      ORDER BY name
    `).all();

    expect(retiredTables).toEqual([]);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN (
        'a2a_possession_chain','a2a_possession','a2a_pass_group',
        'a2a_pass','a2a_handoff_packet'
      )
    `).all()).toHaveLength(5);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('removes the legacy Agent-TeamPack membership table at migration 78', () => {
    db.exec(`
      DELETE FROM _schema_version WHERE version = 78;
      CREATE TABLE agent_team_pack (
        agent_id TEXT NOT NULL,
        pack_id TEXT NOT NULL REFERENCES team_pack(id) ON DELETE CASCADE,
        role_id TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        PRIMARY KEY (agent_id, pack_id)
      );
      INSERT INTO team_pack (
        id, name, display_name, description, workflow, communication_matrix, created_at, updated_at
      ) VALUES (
        'legacy-pack', 'legacy-pack', 'Legacy Pack', '', '{"type":"linear"}', '{}',
        '2026-08-15T00:00:00.000Z', '2026-08-15T00:00:00.000Z'
      );
      INSERT INTO agent_team_pack (agent_id, pack_id, role_id, assigned_at)
      VALUES ('legacy-agent', 'legacy-pack', 'legacy-role', '2026-08-15T00:00:00.000Z');
    `);

    applyMigrations(db);

    expect(db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name='agent_team_pack'
    `).get()).toBeUndefined();
    expect(db.prepare('SELECT version FROM _schema_version WHERE version = 78').get())
      .toEqual({ version: 78 });
  });

  it('repairs v26-v40 checkpoints whose migration collision skipped autonomous delivery tables', () => {
    for (const watermark of [26, 30, 37, 40]) {
      const checkpoint = createTestDb();
      try {
        checkpoint.pragma('foreign_keys = OFF');
        checkpoint.exec(`
          DROP TABLE autonomous_delivery_receipt;
          DROP TABLE IF EXISTS autonomous_delivery_attempt;
          DROP TABLE IF EXISTS autonomous_delivery_action;
          DROP TABLE autonomous_delivery_run;
          DELETE FROM _schema_version WHERE version > ${watermark};
        `);
        checkpoint.pragma('foreign_keys = ON');

        applyMigrations(checkpoint);

        const tables = checkpoint.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'autonomous_delivery_%'",
        ).all() as Array<{ name: string }>;
        expect(new Set(tables.map((table) => table.name))).toEqual(new Set([
          'autonomous_delivery_run',
          'autonomous_delivery_receipt',
          'autonomous_delivery_advancement_request',
        ]));
        expect(checkpoint.prepare('SELECT MAX(version) AS version FROM _schema_version').get())
          .toEqual({ version: 85 });
        expect(checkpoint.pragma('foreign_key_check')).toEqual([]);
      } finally {
        checkpoint.close();
      }
    }
  });

  it('rebuilds the old root task FK while preserving the autonomous run', () => {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE autonomous_delivery_run;
      CREATE TABLE autonomous_delivery_run (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        root_task_id TEXT REFERENCES task(id),
        status TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        goal_contract_json TEXT NOT NULL,
        repair_cycle INTEGER NOT NULL DEFAULT 0,
        escalation_code TEXT,
        escalation_detail TEXT,
        delivery_bundle_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      DELETE FROM _schema_version WHERE version >= 41;
    `);
    db.pragma('foreign_keys = ON');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('conv-checkpoint','Checkpoint','active',?,?)`).run(now, now);
    db.prepare(`INSERT INTO task (id,conversation_id,title,status,agent_id,created_at,updated_at)
      VALUES ('task-checkpoint','conv-checkpoint','Root','ready','agent',?,?)`).run(now, now);
    db.prepare(`INSERT INTO autonomous_delivery_run
      (id,conversation_id,root_task_id,status,current_stage,goal_contract_json,created_at,updated_at)
      VALUES ('run-checkpoint','conv-checkpoint','task-checkpoint','executing','executing','{}',?,?)`)
      .run(now, now);
    applyMigrations(db);

    const rootTaskForeignKey = (db.pragma('foreign_key_list(autonomous_delivery_run)') as Array<{
      from: string;
      on_delete: string;
    }>).find((foreignKey) => foreignKey.from === 'root_task_id');
    expect(rootTaskForeignKey?.on_delete).toBe('SET NULL');
    expect(db.prepare('SELECT revision FROM autonomous_delivery_run WHERE id=?').get('run-checkpoint'))
      .toEqual({ revision: 1 });
    db.prepare('DELETE FROM task WHERE id=?').run('task-checkpoint');
    expect(db.prepare('SELECT root_task_id FROM autonomous_delivery_run WHERE id=?').get('run-checkpoint'))
      .toEqual({ root_task_id: null });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('migrates legacy delivery phases into lifecycle plus stage and enforces the state machine', () => {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      DROP TABLE autonomous_delivery_run;
      CREATE TABLE autonomous_delivery_run (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
        root_task_id TEXT REFERENCES task(id) ON DELETE SET NULL,
        status TEXT NOT NULL,
        current_stage TEXT NOT NULL,
        goal_contract_json TEXT NOT NULL,
        repair_cycle INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        escalation_code TEXT,
        escalation_detail TEXT,
        delivery_bundle_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      DELETE FROM _schema_version WHERE version=58;
    `);
    db.pragma('foreign_keys = ON');
    const now = '2026-07-28T00:00:00.000Z';
    db.prepare(
      'INSERT INTO conversation (id,title,status,created_at,updated_at) VALUES (?,?,?,?,?)',
    ).run('conv-delivery-v58', 'Delivery v58', 'active', now, now);
    const insert = db.prepare(`
      INSERT INTO autonomous_delivery_run (
        id,conversation_id,status,current_stage,goal_contract_json,revision,
        escalation_code,delivery_bundle_json,created_at,updated_at,completed_at
      ) VALUES (?,?,?,?,?,0,?,?,?,?,?)
    `);
    insert.run(
      'run-escalated',
      'conv-delivery-v58',
      'escalated',
      'reviewing',
      '{}',
      null,
      null,
      now,
      now,
      now,
    );
    insert.run(
      'run-recovering',
      'conv-delivery-v58',
      'recovering',
      'verifying',
      '{}',
      null,
      null,
      now,
      now,
      null,
    );
    insert.run(
      'run-completed',
      'conv-delivery-v58',
      'completed',
      'completed',
      '{}',
      null,
      '{}',
      now,
      now,
      now,
    );

    applyMigrations(db);

    expect(db.prepare(`
      SELECT id,status,current_stage,escalation_code,completed_at
      FROM autonomous_delivery_run ORDER BY id
    `).all()).toEqual([
      {
        id: 'run-completed',
        status: 'completed',
        current_stage: 'delivering',
        escalation_code: null,
        completed_at: now,
      },
      {
        id: 'run-escalated',
        status: 'waiting_human',
        current_stage: 'reviewing',
        escalation_code: 'legacy_human_decision_required',
        completed_at: null,
      },
      {
        id: 'run-recovering',
        status: 'retrying',
        current_stage: 'verifying',
        escalation_code: null,
        completed_at: null,
      },
    ]);
    expect(() => db.prepare(
      "UPDATE autonomous_delivery_run SET status='waiting_gate' WHERE id='run-recovering'",
    ).run()).toThrow(/invalid_delivery_run_transition/);
    expect(() => db.prepare(
      "UPDATE autonomous_delivery_run SET status='active' WHERE id='run-completed'",
    ).run()).toThrow(/delivery_run_terminal_immutable/);
    expect(() => db.prepare(`
      INSERT INTO autonomous_delivery_run (
        id,conversation_id,status,current_stage,goal_contract_json,created_at,updated_at
      ) VALUES ('run-invalid','conv-delivery-v58','waiting_human','planning','{}',?,?)
    `).run(now, now)).toThrow(/invalid_delivery_run_state/);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces immutability of published evaluation revisions', () => {
    const revision = db.prepare('SELECT id FROM eval_rubric_revision LIMIT 1').get() as { id: string };
    expect(() => db.prepare('UPDATE eval_rubric_revision SET definition=? WHERE id=?')
      .run('{"tampered":true}', revision.id)).toThrow('published rubric revisions are immutable');
  });
});
