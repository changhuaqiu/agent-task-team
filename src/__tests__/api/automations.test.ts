import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from '@/pages/api/automations';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { projectRepo } from '@/server/repositories/project-repo';
import { AutomationRepository } from '@/server/automations';

function response() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
    setHeader(name: string, value: string) { this.headers[name] = value; return this; },
  };
}

describe('/api/automations', () => {
  beforeEach(() => setTestDb(createTestDb()));
  afterEach(() => resetDb());

  it('returns Project-scoped definitions with durable run history', () => {
    const project = projectRepo.create({ name: 'Alpha', rootPath: 'C:/alpha' });
    const repository = new AutomationRepository();
    const definition = repository.create({
      id: 'automation-1', projectId: project.id, name: '手动通知',
      trigger: { type: 'manual' }, actions: [{ id: 'notify', type: 'notify', message: '开始' }],
    });
    repository.createRun({ id: 'run-1', automationId: definition.id, projectId: project.id, triggerContext: { source: 'manual' } });
    const res = response();

    handler({ method: 'GET', query: { projectId: project.id } } as unknown as NextApiRequest, res as unknown as NextApiResponse);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ automations: [{ id: definition.id, runs: [{ id: 'run-1', status: 'pending' }] }] });
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
