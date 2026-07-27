import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, resetDb, setTestDb } from '../db';
import { DeliveryControlRuntime } from './control-runtime';

describe('DeliveryControlRuntime', () => {
  let db: Database.Database;
  const now = new Date('2026-07-28T12:00:00.000Z');

  beforeEach(() => {
    db = createTestDb();
    setTestDb(db);
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now.toISOString(), now.toISOString());
    db.prepare(`
      INSERT INTO agents (id,name,role_card_id,theme,emoji,created_at,updated_at)
      VALUES ('planner','Planner','preset-planner','default','P',?,?)
    `).run(now.toISOString(), now.toISOString());
  });

  afterEach(() => {
    resetDb();
    db.close();
  });

  it('boots a delivery through ControlDecision and Inbox without legacy DeliveryAction rows', async () => {
    const runtime = new DeliveryControlRuntime({
      workerId: 'test-worker',
      now: () => now,
      policy: {
        revision: 1,
        maxConcurrent: 1,
        roleCapacity: {},
        fairnessAgingMs: 1_000,
      },
    });
    const started = runtime.start({
      goal: 'Ship',
      acceptanceCriteria: ['Works'],
      scope: { conversationId: 'project-1' },
      authorization: {
        allowCodeChanges: true,
        allowPush: false,
        allowPullRequest: false,
        allowAutoMerge: false,
      },
      recoveryPolicy: {
        maxAttemptsPerAction: 2,
        maxRepairCycles: 1,
        stallTimeoutMs: 60_000,
      },
      deliveryPolicy: {
        requireReview: false,
        requireWebE2E: false,
        requireMerge: false,
      },
    });

    expect(await runtime.advance(started.run.id, { kind: 'started' }))
      .toMatchObject({ disposition: 'acted' });
    expect(db.prepare('SELECT title,agent_id,status FROM task').all()).toEqual([{
      title: 'Ship',
      agent_id: 'planner',
      status: 'ready',
    }]);
    expect(db.prepare(`
      SELECT project_agent_id,status,json_extract(command_json,'$.source') AS source
      FROM agent_inbox_item
    `).all()).toEqual([{
      project_agent_id: 'planner',
      status: 'enqueued',
      source: 'system',
    }]);
    expect((db.prepare(`
      SELECT COUNT(*) AS count FROM delivery_control_action
    `).get() as { count: number }).count).toBeGreaterThan(0);
    expect(db.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('autonomous_delivery_action','autonomous_delivery_attempt')
    `).all()).toEqual([]);
  });
});
