import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../db';
import { PlatformEventDispatcher } from './dispatcher';
import { PlatformEventLog } from './event-log';
import { RuntimeEventPublisher } from './runtime-event-publisher';
import { RuntimeInvocationProjection } from './runtime-invocation-projection';

describe('RuntimeInvocationProjection', () => {
  let db: Database.Database;
  let log: PlatformEventLog;
  let projection: RuntimeInvocationProjection;
  let id = 0;

  beforeEach(() => {
    db = createTestDb();
    const now = '2026-07-25T00:00:00.000Z';
    db.prepare(`
      INSERT INTO conversation (id,title,status,created_at,updated_at)
      VALUES ('project-1','Project','active',?,?)
    `).run(now, now);
    log = new PlatformEventLog({
      db,
      now: () => new Date(now),
      idFactory: () => `pev-${++id}`,
    });
    projection = new RuntimeInvocationProjection(db);
  });

  afterEach(() => db.close());

  function publishLifecycle() {
    const publisher = new RuntimeEventPublisher(log, {
      projectId: 'project-1',
      projectAgentId: 'implementer',
      invocationId: 'inv-1',
      runtimeActorId: 'daemon:local',
      correlationId: 'corr-1',
    });
    publisher.publish('runtime.invocation.accepted', {});
    publisher.publish('runtime.invocation.started', { adapter: 'acp', engine: 'codex' });
    publisher.publish('runtime.invocation.terminated', {
      outcome: 'completed',
      durationMs: 10,
    });
  }

  it('materializes lifecycle events through the durable dispatcher', async () => {
    publishLifecycle();
    const dispatcher = new PlatformEventDispatcher({
      db,
      eventLog: log,
      now: () => new Date('2026-07-25T00:00:01.000Z'),
      idFactory: (prefix) => `${prefix}-${++id}`,
    });
    dispatcher.register({
      id: 'runtime-invocation-projection:v1',
      pattern: 'runtime.invocation.*',
      stereotype: 'projection',
      reliability: 'durable',
      handle: (event, { signal }) => projection.handle(event, signal),
    });
    expect(dispatcher.recover().enqueued).toBe(3);
    expect((await dispatcher.drain()).succeeded).toBe(1);
    expect((await dispatcher.drain()).succeeded).toBe(1);
    expect((await dispatcher.drain()).succeeded).toBe(1);

    expect(projection.listByProject('project-1')).toMatchObject([{
      invocation_id: 'inv-1',
      project_agent_id: 'implementer',
      status: 'terminated',
      outcome: 'completed',
      last_stream_sequence: 3,
    }]);
  });

  it('rebuilds the same projection solely from platform_event', () => {
    publishLifecycle();
    projection.rebuild();
    const before = projection.listByProject('project-1');
    db.prepare(`
      UPDATE runtime_invocation_projection
      SET status='accepted', outcome=NULL, last_stream_sequence=1
    `).run();

    expect(projection.rebuild()).toBe(3);
    expect(projection.listByProject('project-1')).toEqual(before);
  });
});
