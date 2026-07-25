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
    expect(tableNames).toContain('eval_review_queue');
    expect(tableNames).toContain('eval_pairwise_round');
    expect(tableNames).toContain('github_issue_ingress');
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

  it('tracks schema version', () => {
    const row = db.prepare('SELECT MAX(version) as v FROM _schema_version').get() as {
      v: number;
    };
    expect(row.v).toBeGreaterThanOrEqual(1);
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
      ).run('task-1', 'nonexistent', 'Test', 'pending', 'agent-1', now, now);
    }).toThrow();
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
        id,conversation_id,agent_id,status,engine,created_at,updated_at
      ) VALUES (?,?,?,'completed','codex',?,?)
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
      .toEqual({ version: 52 });
  });

  it('repairs v26-v40 checkpoints whose migration collision skipped autonomous delivery tables', () => {
    for (const watermark of [26, 30, 37, 40]) {
      const checkpoint = createTestDb();
      try {
        checkpoint.pragma('foreign_keys = OFF');
        checkpoint.exec(`
          DROP TABLE autonomous_delivery_receipt;
          DROP TABLE autonomous_delivery_attempt;
          DROP TABLE autonomous_delivery_action;
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
          'autonomous_delivery_action',
          'autonomous_delivery_attempt',
          'autonomous_delivery_receipt',
          'autonomous_delivery_advancement_request',
        ]));
        expect(checkpoint.prepare('SELECT MAX(version) AS version FROM _schema_version').get())
          .toEqual({ version: 52 });
        expect(checkpoint.pragma('foreign_key_check')).toEqual([]);
      } finally {
        checkpoint.close();
      }
    }
  });

  it('rebuilds the old root task FK while preserving autonomous run and action rows', () => {
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
      VALUES ('task-checkpoint','conv-checkpoint','Root','pending','agent',?,?)`).run(now, now);
    db.prepare(`INSERT INTO autonomous_delivery_run
      (id,conversation_id,root_task_id,status,current_stage,goal_contract_json,created_at,updated_at)
      VALUES ('run-checkpoint','conv-checkpoint','task-checkpoint','executing','executing','{}',?,?)`)
      .run(now, now);
    db.prepare(`INSERT INTO autonomous_delivery_action
      (id,run_id,kind,idempotency_key,status,not_before,max_attempts,created_at,updated_at)
      VALUES ('action-checkpoint','run-checkpoint','advance_tasks','checkpoint-action','ready',?,3,?,?)`)
      .run(now, now, now);

    applyMigrations(db);

    const rootTaskForeignKey = (db.pragma('foreign_key_list(autonomous_delivery_run)') as Array<{
      from: string;
      on_delete: string;
    }>).find((foreignKey) => foreignKey.from === 'root_task_id');
    expect(rootTaskForeignKey?.on_delete).toBe('SET NULL');
    expect(db.prepare('SELECT revision FROM autonomous_delivery_run WHERE id=?').get('run-checkpoint'))
      .toEqual({ revision: 0 });
    expect(db.prepare('SELECT run_id FROM autonomous_delivery_action WHERE id=?').get('action-checkpoint'))
      .toEqual({ run_id: 'run-checkpoint' });

    db.prepare('DELETE FROM task WHERE id=?').run('task-checkpoint');
    expect(db.prepare('SELECT root_task_id FROM autonomous_delivery_run WHERE id=?').get('run-checkpoint'))
      .toEqual({ root_task_id: null });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('enforces immutability of published evaluation revisions', () => {
    const revision = db.prepare('SELECT id FROM eval_rubric_revision LIMIT 1').get() as { id: string };
    expect(() => db.prepare('UPDATE eval_rubric_revision SET definition=? WHERE id=?')
      .run('{"tampered":true}', revision.id)).toThrow('published rubric revisions are immutable');
  });
});
