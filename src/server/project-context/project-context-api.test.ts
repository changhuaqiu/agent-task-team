import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import inspectHandler from '@/pages/api/project-context';
import mutationsHandler from '@/pages/api/mutations';
import { createTestDb, resetDb, setTestDb } from '@/server/db';
import { projectContextService } from '@/server/project-context';
import { conversationRepo } from '@/server/repositories/conversation-repo';

let root: string;

function request(body: unknown): NextApiRequest {
  return { method: 'POST', body } as unknown as NextApiRequest;
}

type TestResponse = NextApiResponse & {
  statusCode: number;
  headers: Record<string, string>;
  body: {
    ok?: boolean;
    reasonCode?: string;
    candidates?: string[];
  };
  headersSent: boolean;
};

function response(): TestResponse {
  const result = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: {},
    headersSent: false,
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
    status(code: number) {
      result.statusCode = code;
      return result;
    },
    json(body: unknown) {
      result.body = body;
      result.headersSent = true;
      return result;
    },
  };
  return result as unknown as TestResponse;
}

function write(relativePath: string, content: string): void {
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content, 'utf8');
}

beforeEach(() => {
  setTestDb(createTestDb());
  root = mkdtempSync(path.join(tmpdir(), 'project-context-api-'));
});

afterEach(() => {
  resetDb();
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('project context API integration', () => {
  it('inspects a codebase without writing generated context', async () => {
    write('package.json', '{"name":"inspect-only"}');
    const res = response();
    await inspectHandler(request({ path: root }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      inspection: {
        classification: 'codebase',
        existingContext: false,
        activeWorkstreamCount: 0,
      },
    });
    expect(existsSync(path.join(root, '.ath'))).toBe(false);
  });

  it('initializes context as part of conversation.create', async () => {
    write('package.json', JSON.stringify({
      name: 'created-project',
      scripts: { test: 'vitest run' },
    }));
    write('AGENTS.md', '# Rules\n\nRun tests before handoff.');
    const res = response();
    await mutationsHandler(request({
      type: 'conversation.create',
      payload: {
        id: 'conv-created',
        title: 'Created project',
        goal: 'Create reusable context',
        project_path: root,
      },
    }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(conversationRepo.getById('conv-created')).toBeDefined();
    expect(existsSync(path.join(root, '.ath/context/manifest.json'))).toBe(true);
    expect(existsSync(path.join(root, '.ath/context/workstreams'))).toBe(true);
  });

  it('rolls back conversation.create when the selected directory contains multiple projects', async () => {
    write('api/package.json', '{"name":"api"}');
    write('web/package.json', '{"name":"web"}');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = response();
    await mutationsHandler(request({
      type: 'conversation.create',
      payload: {
        id: 'conv-ambiguous',
        title: 'Ambiguous project',
        goal: 'Must select a concrete root',
        project_path: root,
      },
    }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({
      ok: false,
      reasonCode: 'ambiguous_workspace',
    });
    expect(res.body.candidates).toHaveLength(2);
    expect(conversationRepo.getById('conv-ambiguous')).toBeUndefined();
    expect(existsSync(path.join(root, '.ath'))).toBe(false);
  });

  it('removes a workstream projection when creation fails after context publication', async () => {
    write('package.json', '{"name":"rollback-project"}');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const prepare = projectContextService.prepare.bind(projectContextService);
    vi.spyOn(projectContextService, 'prepare').mockImplementation(async (input) => {
      const result = await prepare(input);
      if (input.mode === 'initialize') throw new Error('failure after workstream publication');
      return result;
    });
    const res = response();
    await mutationsHandler(request({
      type: 'conversation.create',
      payload: {
        id: 'conv-failed-after-projection',
        title: 'Projection must roll back',
        goal: 'Do not leave a phantom workstream',
        project_path: root,
      },
    }), res);

    expect(res.statusCode).toBe(500);
    expect(conversationRepo.getById('conv-failed-after-projection')).toBeUndefined();
    const workstreamRoot = path.join(root, '.ath/context/workstreams');
    expect(readdirSync(workstreamRoot).filter(name => name.endsWith('.json'))).toEqual([]);
    expect(readFileSync(path.join(workstreamRoot, 'INDEX.md'), 'utf8'))
      .not.toContain('Projection must roll back');
  });

  it('re-reads authoritative workstreams after locking concurrent creations', async () => {
    write('package.json', '{"name":"concurrent-project"}');
    const firstResponse = response();
    const secondResponse = response();
    await Promise.all([
      mutationsHandler(request({
        type: 'conversation.create',
        payload: {
          id: 'conv-concurrent-first',
          title: 'Concurrent first',
          goal: 'Keep both workstreams',
          project_path: root,
        },
      }), firstResponse),
      mutationsHandler(request({
        type: 'conversation.create',
        payload: {
          id: 'conv-concurrent-second',
          title: 'Concurrent second',
          goal: 'Keep both workstreams',
          project_path: root,
        },
      }), secondResponse),
    ]);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(readdirSync(path.join(root, '.ath/context/workstreams'))
      .filter(name => name.endsWith('.json'))).toHaveLength(2);
    const index = readFileSync(path.join(root, '.ath/context/workstreams/INDEX.md'), 'utf8');
    expect(index).toContain('Concurrent first');
    expect(index).toContain('Concurrent second');
  });
});
