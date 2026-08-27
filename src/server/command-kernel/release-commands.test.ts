import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, getDb, resetDb, setTestDb } from '../db';
import { projectRepo } from '../repositories/project-repo';
import {
  asReleaseCreateCommand,
  asReleasePublishCommand,
  CommandService,
} from './service';

describe('Release commands', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('creates an optional draft and only publishes after every frozen target is verified', () => {
    const project = projectRepo.create({ name: 'Release', rootPath: 'C:/release' });
    const service = new CommandService();
    const workId = 'release-work';
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO task (id,conversation_id,title,description,status,agent_id,dependencies,artifacts,created_at,updated_at,revision,category)
      VALUES (?,?,?,'','ready','','[]','[]',?,?,0,'change_request')
    `).run(workId, project.workspace_conversation_id, 'Ship verified desktop', now, now);
    const create = asReleaseCreateCommand({
      commandId: 'release-create', idempotencyKey: 'release-create', projectId: project.id,
      name: 'v1 preview', targets: [{ type: 'work', id: workId }],
    });
    const created = service.execute(create);
    expect(created).toMatchObject({ status: 'applied', revision: 1, result: { release: { status: 'draft', targets: [{ type: 'work', id: workId }] } } });
    expect(service.execute(create)).toMatchObject({ status: 'duplicate', eventIds: created.eventIds });
    const releaseId = created.subject!.id;

    expect(service.execute(asReleasePublishCommand({
      commandId: 'release-too-early', idempotencyKey: 'release-too-early', projectId: project.id,
      releaseId, expectedRevision: 1,
    }))).toMatchObject({ status: 'rejected', reasonCode: 'release_work_not_done' });

    getDb().exec('DROP TRIGGER IF EXISTS trg_task_transition_update');
    getDb().prepare("UPDATE task SET status='done' WHERE id=?").run(workId);
    const publish = asReleasePublishCommand({
      commandId: 'release-publish', idempotencyKey: 'release-publish', projectId: project.id,
      releaseId, expectedRevision: 1,
    });
    const published = service.execute(publish);
    expect(published).toMatchObject({ status: 'applied', revision: 2, result: { release: { status: 'published', publishedAt: expect.any(String) } } });
    expect(service.execute(publish)).toMatchObject({ status: 'duplicate', eventIds: published.eventIds, revision: 2 });
  });
});
