import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, setTestDb, resetDb } from '@/server/db/index';
import { resetSeq } from '@/server/repositories/sortable-id';
import { mockReq, mockRes } from '@/test-helpers/mock-api';
import handler from '@/pages/api/skills/index';
import detailHandler from '@/pages/api/skills/[id]';
import agentSkillsHandler from '@/pages/api/agents/[agentId]/skills';
import { RepositorySkillRuntime } from '@/server/skills/skill-runtime';
import { buildSkillPackageInput } from '@/test-helpers/skill-package';
import { skillRepo } from '@/server/repositories/skill-repo';

let skillDataDir: string;
let previousSkillDataDir: string | undefined;

beforeEach(async () => {
  setTestDb(createTestDb());
  resetSeq();
  previousSkillDataDir = process.env.ATH_DATA_DIR;
  skillDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ath-skill-api-'));
  process.env.ATH_DATA_DIR = skillDataDir;
});
afterEach(async () => {
  resetDb();
  if (previousSkillDataDir === undefined) delete process.env.ATH_DATA_DIR;
  else process.env.ATH_DATA_DIR = previousSkillDataDir;
  await fs.rm(skillDataDir, { recursive: true, force: true });
});

describe('GET /api/skills', () => {
  it('returns empty list', async () => {
    const req = mockReq('GET');
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json).toEqual([]);
  });
});

describe('POST /api/skills', () => {
  it('creates a skill', async () => {
    const req = mockReq('POST', { name: 'code-review', description: 'Code review', content: '# Review\nCheck.' });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.name).toBe('code-review');
    // Verify in list
    const listRes = mockRes();
    await handler(mockReq('GET'), listRes);
    expect(listRes._json).toHaveLength(1);
  });

  it('rejects duplicate name', async () => {
    await handler(mockReq('POST', { name: 'dup', content: 'c1' }), mockRes());
    const res = mockRes();
    await handler(mockReq('POST', { name: 'dup', content: 'c2' }), res);
    expect(res.statusCode).toBe(409);
  });

  it('creates skill with files', async () => {
    const req = mockReq('POST', { name: 'with-files', content: 'instructions', files: [{ path: 'check.md', content: 'checklist' }] });
    const res = mockRes();
    await handler(req, res);
    expect(res.statusCode).toBe(201);
    expect(res._json.fileCount).toBe(1);
  });

  it('rejects missing name or content', async () => {
    const res = mockRes();
    await handler(mockReq('POST', { content: 'no name' }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/skills/:id', () => {
  it('returns skill with files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'detail', content: 'c', files: [{ path: 'ref.md', content: 'reference' }] }), createRes);
    const req = mockReq('GET', undefined, { id: createRes._json.id });
    const res = mockRes();
    await detailHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res._json.files).toHaveLength(1);
  });

  it('returns the active installed revision without exposing package paths', async () => {
    const revision = await new RepositorySkillRuntime().install(buildSkillPackageInput({
      name: 'installed-detail', description: 'Installed detail', content: 'Use it.',
      files: [{ path: 'references/guide.md', content: 'guide' }],
    }));
    const res = mockRes();
    await detailHandler(mockReq('GET', undefined, { id: revision.skillId }), res);
    expect(res._json.activeRevision).toMatchObject({ id: revision.revision, contentHash: revision.contentHash });
    expect(res._json.activeRevision.files[0]).toMatchObject({ path: 'references/guide.md', kind: 'reference' });
    expect(res._json.activeRevision.packagePath).toBeUndefined();
  });

  it('returns 404 for missing skill', async () => {
    const res = mockRes();
    await detailHandler(mockReq('GET', undefined, { id: 'nonexistent' }), res);
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/skills/:id', () => {
  it('updates and replaces files', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'update', content: 'old', files: [{ path: 'old.md', content: 'old' }] }), createRes);
    const id = createRes._json.id;
    const res = mockRes();
    await detailHandler(mockReq('PATCH', { description: 'new', files: [{ path: 'new.md', content: 'new' }] }, { id }), res);
    expect(res.statusCode).toBe(200);
    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes._json.files).toHaveLength(1);
    expect(getRes._json.files[0].path).toBe('new.md');
  });

  it('invalidates and rebuilds the active revision after a config-only update', async () => {
    const runtime = new RepositorySkillRuntime();
    const first = await runtime.install(buildSkillPackageInput({
      name: 'config-api-update',
      description: 'Config API update',
      content: 'Use configured tools.',
      files: [],
      config: '{"tools":["Read"]}',
    }));

    const patchRes = mockRes();
    await detailHandler(
      mockReq('PATCH', { config: '{"tools":["Write"]}' }, { id: first.skillId }),
      patchRes,
    );
    expect(patchRes.statusCode).toBe(200);

    const compiled = await runtime.compile({ skillIds: [first.skillId] });
    expect(compiled.activated[0].revision).not.toBe(first.revision);
    expect(compiled.activated[0].config).toBe('{"tools":["Write"]}');
  });
});

describe('DELETE /api/skills/:id', () => {
  it('deletes a skill', async () => {
    const createRes = mockRes();
    await handler(mockReq('POST', { name: 'delete', content: 'c' }), createRes);
    const id = createRes._json.id;
    const res = mockRes();
    await detailHandler(mockReq('DELETE', undefined, { id }), res);
    expect(res.statusCode).toBe(200);
    const getRes = mockRes();
    await detailHandler(mockReq('GET', undefined, { id }), getRes);
    expect(getRes.statusCode).toBe(404);
  });
});

describe('GET /api/agents/:agentId/skills', () => {
  it('returns skills assigned to agent', async () => {
    // Create two skills
    const r1 = mockRes(); await handler(mockReq('POST', { name: 'review', content: 'review content' }), r1);
    const r2 = mockRes(); await handler(mockReq('POST', { name: 'tdd', content: 'tdd content' }), r2);

    // Repository setup only; the public write path is agent.update.
    skillRepo.setAgentSkills('mario', [r1._json.id, r2._json.id]);

    const getRes = mockRes();
    await agentSkillsHandler(mockReq('GET', undefined, { agentId: 'mario' }), getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes._json).toHaveLength(2);
  });
});

describe('POST /api/agents/:agentId/skills', () => {
  it('rejects the independent skill write path', async () => {
    const res = mockRes();
    await agentSkillsHandler(mockReq('POST', { skillIds: ['skill-a'] }, { agentId: 'luigi' }), res);
    expect(res.statusCode).toBe(410);
    expect(res._json).toMatchObject({ reasonCode: 'use_agent_update_command' });
  });
});
